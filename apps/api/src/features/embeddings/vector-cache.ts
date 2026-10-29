/**
 * In-memory vector matrices, one per (collection, user), loaded on the first query.
 *
 * A search scores EVERY vector (that is what gives the z-scale), so the vectors live in one
 * contiguous float32 matrix and a query is a single pass over it. Writes keep a loaded matrix
 * current without a reload in the common case — a new item is appended in place; replacing or
 * removing a key that is already loaded marks the matrix stale and the next query reloads it.
 * A matrix nobody queried for `releaseMs` is dropped; the next query loads it again.
 */
import {
  centroidSimilarities,
  correctHubness,
  decodeVector,
  MIN_POPULATION,
  scoreRows,
  standardize,
  standoutGate,
} from './vectors'
import type { SemanticStore, VectorRow } from './store'

export interface RankedChunk {
  id: number
  key: string
  chunk: number
  scope: string | null
  z: number
  /** The z this collection needs for a match to stand out (`standoutGate`). */
  gate: number
  cosine: number
}

interface Matrix {
  rows: Float32Array
  count: number
  ids: number[]
  keys: string[]
  chunks: number[]
  scopes: (string | null)[]
  keySet: Set<string>
  stale: boolean
  usedAt: number
  /** Centroid similarity per row, recomputed after rows change (null = due). */
  hubs: Float32Array | null
}

const DEFAULT_RELEASE_MS = 10 * 60_000

export function createVectorCache(
  store: Pick<SemanticStore, 'loadVectors'>,
  dimensions: () => number,
  options: { releaseMs?: number; now?: () => number } = {},
) {
  const matrices = new Map<string, Matrix>()
  const loading = new Map<string, Promise<Matrix>>()
  const releaseMs = options.releaseMs ?? DEFAULT_RELEASE_MS
  const clock = options.now ?? Date.now
  const slot = (collection: string, userId: string) => `${collection}\u0000${userId}`

  function append(
    m: Matrix,
    row: Pick<VectorRow, 'id' | 'item_key' | 'chunk' | 'scope'>,
    v: Float32Array,
  ) {
    const dims = dimensions()
    if ((m.count + 1) * dims > m.rows.length) {
      const grown = new Float32Array(Math.max(m.rows.length * 2, dims * 64))
      grown.set(m.rows.subarray(0, m.count * dims))
      m.rows = grown
    }
    m.rows.set(v, m.count * dims)
    m.count += 1
    m.ids.push(row.id)
    m.keys.push(row.item_key)
    m.chunks.push(row.chunk)
    m.scopes.push(row.scope)
    m.keySet.add(row.item_key)
    m.hubs = null
  }

  async function load(collection: string, userId: string): Promise<Matrix> {
    const dims = dimensions()
    const rows = await store.loadVectors(collection, userId)
    const m: Matrix = {
      rows: new Float32Array(Math.max(rows.length, 64) * dims),
      count: 0,
      ids: [],
      keys: [],
      chunks: [],
      scopes: [],
      keySet: new Set(),
      stale: false,
      usedAt: clock(),
      hubs: null,
    }
    for (const row of rows) {
      // A row of another width belongs to a vector space the collection already left.
      if (row.vector.byteLength !== dims * 2) continue
      append(m, row, decodeVector(row.vector, dims))
    }
    return m
  }

  async function matrixFor(collection: string, userId: string): Promise<Matrix> {
    const key = slot(collection, userId)
    const current = matrices.get(key)
    if (current && !current.stale) return current
    let pending = loading.get(key)
    if (!pending) {
      pending = load(collection, userId).finally(() => loading.delete(key))
      loading.set(key, pending)
    }
    const fresh = await pending
    matrices.set(key, fresh)
    return fresh
  }

  return {
    async rank(
      collection: string,
      userId: string,
      query: Float32Array,
      opts: { limit: number; scope?: ReadonlySet<string>; minZ?: number },
    ): Promise<RankedChunk[]> {
      const m = await matrixFor(collection, userId)
      m.usedAt = clock()
      if (m.count === 0) return []
      const cosines = scoreRows(m.rows, m.count, dimensions(), query)
      const raw = Float32Array.from(cosines)
      // A collection too small to define a distribution has no centroid worth correcting by.
      if (m.count >= MIN_POPULATION) {
        m.hubs ??= centroidSimilarities(m.rows, m.count, dimensions())
        correctHubness(cosines, m.hubs)
      }
      const z = standardize(cosines)
      const gate = standoutGate(m.count)
      // Best chunk per key: an item is one result however many of its chunks matched.
      const best = new Map<string, number>()
      for (let i = 0; i < m.count; i++) {
        if (opts.scope && !opts.scope.has(m.scopes[i] ?? '')) continue
        if (opts.minZ !== undefined && z[i]! < opts.minZ) continue
        const at = best.get(m.keys[i]!)
        if (at === undefined || z[i]! > z[at]!) best.set(m.keys[i]!, i)
      }
      return [...best.values()]
        .sort((a, b) => z[b]! - z[a]!)
        .slice(0, opts.limit)
        .map((i) => ({
          id: m.ids[i]!,
          key: m.keys[i]!,
          chunk: m.chunks[i]!,
          scope: m.scopes[i]!,
          z: z[i]!,
          gate,
          cosine: raw[i]!,
        }))
    },

    /**
     * The weighted mean of these items' stored vectors (each item the mean of its chunks),
     * normalized: a query made of items rather than words. Null when none of them has a vector.
     */
    async centroid(
      collection: string,
      userId: string,
      members: ReadonlyArray<{ key: string; weight: number }>,
    ): Promise<Float32Array | null> {
      const m = await matrixFor(collection, userId)
      m.usedAt = clock()
      const dims = dimensions()
      const weights = new Map(members.map((member) => [member.key, member.weight]))
      const chunks = new Map<string, number>()
      for (let i = 0; i < m.count; i++)
        if (weights.has(m.keys[i]!)) chunks.set(m.keys[i]!, (chunks.get(m.keys[i]!) ?? 0) + 1)
      if (chunks.size === 0) return null
      const sum = new Float32Array(dims)
      for (let i = 0; i < m.count; i++) {
        const key = m.keys[i]!
        const weight = weights.get(key)
        if (weight === undefined) continue
        const share = weight / chunks.get(key)!
        for (let d = 0; d < dims; d++) sum[d] = sum[d]! + share * m.rows[i * dims + d]!
      }
      let norm = 0
      for (let d = 0; d < dims; d++) norm += sum[d]! ** 2
      if (norm === 0) return null
      const scale = 1 / Math.sqrt(norm)
      for (let d = 0; d < dims; d++) sum[d] = sum[d]! * scale
      return sum
    },

    /** An item was (re)written with these rows. */
    written(
      collection: string,
      userId: string,
      key: string,
      rows: Array<{ id: number; chunk: number; scope: string | null; vector: Float32Array }>,
    ) {
      const m = matrices.get(slot(collection, userId))
      if (!m || m.stale) return
      if (m.keySet.has(key)) {
        m.stale = true
        return
      }
      for (const row of rows)
        append(m, { id: row.id, item_key: key, chunk: row.chunk, scope: row.scope }, row.vector)
    },

    removed(collection: string, keys: readonly string[]) {
      for (const [slotKey, m] of matrices) {
        if (!slotKey.startsWith(`${collection}\u0000`)) continue
        if (keys.some((k) => m.keySet.has(k))) m.stale = true
      }
    },

    /** Forget a whole collection (new vector space) or everything. */
    drop(collection?: string) {
      // Deleting the current key while iterating a Map is safe: it moves on to the next one.
      for (const slotKey of matrices.keys()) {
        if (!collection || slotKey.startsWith(`${collection}\u0000`)) matrices.delete(slotKey)
      }
    },

    /** Release matrices nobody queried recently. Called by the index's housekeeping timer. */
    releaseIdle() {
      const cutoff = clock() - releaseMs
      for (const [slotKey, m] of matrices) if (m.usedAt < cutoff) matrices.delete(slotKey)
    },

    loadedRows(): number {
      let n = 0
      for (const m of matrices.values()) n += m.count
      return n
    },
  }
}

export type VectorCache = ReturnType<typeof createVectorCache>
