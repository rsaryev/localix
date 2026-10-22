/**
 * The background indexer: keeps every registered source's collection in step with its data.
 *
 * Two kinds of work, in this order on every pass:
 *   1. RECONCILE — a full `scan` of a collection whose vector space is new (first enable, new
 *      model, new source version) or whose data may have moved while indexing was off. Items
 *      whose hash is unchanged cost a read; keys the scan never saw are deleted at the end.
 *   2. CHANGES — the outbox (keys the change feed and plugins name): read back from their source;
 *      a key the source no longer returns is gone.
 *
 * A pass runs when something says there is work — the engine starts or resumes, a source registers,
 * a change is queued (`kick`), a rescan is asked for — never on a timer: every outbox write goes
 * through the service, which kicks. Failures never drop work: a failed batch stays queued and
 * retries with backoff. Progress (counts, rate, ETA) feeds the status bar.
 */
import type { SemanticSource } from '@localixai/plugin-sdk/backend'
import type { EmbeddingEngine } from './engine'
import { ingestItems, removeKeys, type IngestStats } from './ingest'
import type { SemanticStore } from './store'
import type { VectorCache } from './vector-cache'

const SCAN_PAGE = 64
const OUTBOX_PAGE = 128
const RETRY_MS = [5_000, 15_000, 60_000]
/** The rate shown (and the ETA built on it) covers this much recent work, not the whole run. */
const RATE_WINDOW_MS = 30_000

export type IndexerPhase = 'stopped' | 'idle' | 'reconciling' | 'updating' | 'retrying' | 'paused'

export interface CollectionProgress {
  collection: string
  label: string
  /** Items a running reconcile has visited / will visit (null when the source cannot count). */
  scanned: number | null
  total: number | null
  reconciling: boolean
}

export interface IndexerProgress {
  phase: IndexerPhase
  collections: CollectionProgress[]
  pendingChanges: number
  /** Chunks embedded per second over the last half minute (null before the first batch). */
  chunksPerSecond: number | null
  lastError: string | null
}

export interface IndexerDeps {
  store: SemanticStore
  cache: VectorCache
  sources: () => readonly SemanticSource[]
  onProgress?: () => void
  log?: (event: string, fields: Record<string, unknown>) => void
  /** Arms the retry after a failed pass; returns its cancel. Test seam. */
  setTimer?: (fire: () => void, ms: number) => () => void
}

function unrefTimer(fire: () => void, ms: number): () => void {
  const timer = setTimeout(fire, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

export function createIndexer(deps: IndexerDeps) {
  const { store, cache } = deps
  let engine: EmbeddingEngine | null = null
  let phase: IndexerPhase = 'stopped'
  let lastError: string | null = null
  let failures = 0
  const setTimer = deps.setTimer ?? unrefTimer
  let cancelRetry: (() => void) | null = null
  let running: Promise<void> | null = null
  let rerun = false
  /** Set by a person: no pass starts, and a running one stops at its next page. */
  let paused = false
  let pendingChanges = 0
  const reconcile = new Map<string, { scanned: number; total: number | null }>()
  // Recent batches: when each finished, its chunks and how long it took.
  const batches: Array<{ at: number; chunks: number; ms: number }> = []

  function chunksPerSecond(): number | null {
    let chunks = 0
    let ms = 0
    for (const b of batches) {
      chunks += b.chunks
      ms += b.ms
    }
    return ms > 0 ? Math.round((chunks / ms) * 10_000) / 10 : null
  }

  const setPhase = (next: IndexerPhase) => {
    if (phase === next) return
    phase = next
    deps.onProgress?.()
  }

  /** The pass in hand should stop: a new engine took over, or indexing was paused. */
  const halted = (active: EmbeddingEngine) => engine !== active || paused

  const fingerprintFor = (source: SemanticSource) => `${engine!.fingerprint}#v${source.version}`

  async function measured(collection: string, work: () => Promise<IngestStats>) {
    const started = performance.now()
    const stats = await work()
    if (stats.chunks > 0) {
      const now = Date.now()
      batches.push({ at: now, chunks: stats.chunks, ms: performance.now() - started })
      while (batches.length > 0 && now - batches[0]!.at > RATE_WINDOW_MS) batches.shift()
      deps.log?.('semantic.indexed', { collection, ...stats })
    }
    return stats
  }

  async function reconcileSource(source: SemanticSource, active: EmbeddingEngine) {
    const name = source.collection
    let state = await store.readCollection(name)
    const fingerprint = fingerprintFor(source)
    if (!state || state.fingerprint !== fingerprint) {
      // A different vector space: nothing stored can be compared with a new query vector.
      await store.clearCollection(name)
      cache.drop(name)
      state = {
        name,
        fingerprint,
        sourceVersion: source.version,
        backfillCursor: null,
        backfillDone: false,
      }
      await store.writeCollection(state)
    }
    if (state.backfillDone) return
    setPhase('reconciling')
    const seen = new Set<string>()
    const progress = { scanned: 0, total: (await source.count?.().catch(() => null)) ?? null }
    reconcile.set(name, progress)
    deps.onProgress?.()
    // A resumed scan cannot know which keys the earlier part saw, so it does not prune.
    const canPrune = state.backfillCursor === null
    let cursor = state.backfillCursor
    for (;;) {
      // A paused scan keeps its cursor and its progress: resuming continues from this page.
      if (halted(active)) return
      const page = await source.scan(cursor, SCAN_PAGE)
      for (const item of page.items) seen.add(item.key)
      await measured(name, () => ingestItems({ store, cache, engine: active }, name, page.items))
      progress.scanned += page.items.length
      cursor = page.next
      await store.writeCollection({
        ...state,
        backfillCursor: cursor,
        backfillDone: cursor === null,
      })
      deps.onProgress?.()
      if (cursor === null) break
      await Bun.sleep(0)
    }
    if (canPrune) {
      const gone = (await store.keysOf(name)).filter((key) => !seen.has(key))
      await removeKeys({ store, cache }, name, gone)
    }
    reconcile.delete(name)
  }

  async function drainOutbox(active: EmbeddingEngine) {
    const byName = new Map(deps.sources().map((s) => [s.collection, s]))
    for (;;) {
      if (halted(active)) return
      const rows = await store.takeOutbox(OUTBOX_PAGE)
      pendingChanges = await store.outboxSize()
      if (rows.length === 0) return
      setPhase('updating')
      const grouped = new Map<string, typeof rows>()
      for (const row of rows)
        grouped.set(row.collection, [...(grouped.get(row.collection) ?? []), row])
      for (const [collection, group] of grouped) {
        const source = byName.get(collection)
        if (source) {
          const keys = group.map((r) => r.item_key)
          const items = await source.read(keys)
          const present = new Set(items.map((i) => i.key))
          await measured(collection, () =>
            ingestItems({ store, cache, engine: active }, collection, items),
          )
          await removeKeys(
            { store, cache },
            collection,
            keys.filter((k) => !present.has(k)),
          )
        }
        // An unregistered collection's changes (a disabled plugin) are dropped: its next
        // registration reconciles from a full scan anyway.
        await store.ackOutbox(group.map((r) => r.seq))
      }
      deps.onProgress?.()
    }
  }

  async function pass() {
    const active = engine
    if (!active) return
    try {
      for (const source of deps.sources()) {
        if (halted(active)) break
        await reconcileSource(source, active)
      }
      if (!halted(active)) await drainOutbox(active)
      if (paused) return setPhase('paused')
      if (engine !== active) return
      failures = 0
      lastError = null
      setPhase('idle')
    } catch (err) {
      failures += 1
      lastError = err instanceof Error ? err.message : String(err)
      deps.log?.('semantic.index_failed', { error: lastError, failures })
      setPhase('retrying')
    }
  }

  function schedule(ms: number) {
    cancelRetry?.()
    cancelRetry = setTimer(() => {
      cancelRetry = null
      kick()
    }, ms)
  }

  function kick() {
    if (!engine || paused) return
    if (running) {
      rerun = true
      return
    }
    running = pass().finally(() => {
      running = null
      if (!engine || paused) return
      if (rerun) {
        rerun = false
        return kick()
      }
      if (phase === 'retrying') schedule(RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]!)
    })
  }

  return {
    /** Index with this engine (enable / model ready). Restarts reconciliation if the space changed. */
    start(next: EmbeddingEngine) {
      engine = next
      paused = false
      batches.length = 0
      setPhase('idle')
      kick()
    },
    async stop() {
      engine = null
      paused = false
      cancelRetry?.()
      cancelRetry = null
      await running?.catch(() => {})
      reconcile.clear()
      setPhase('stopped')
    },
    /** Stop indexing until `resume`: the running pass ends at its next page, keeping its place. */
    async pause() {
      if (!engine) return
      paused = true
      cancelRetry?.()
      cancelRetry = null
      await running?.catch(() => {})
      setPhase('paused')
    },
    resume() {
      if (!paused) return
      paused = false
      setPhase('idle')
      kick()
    },
    /** Something changed (plugin `changed()`, a newly registered source): run soon. */
    kick,
    /** Resolves once no pass is running or queued behind the one in hand. */
    async whenSettled() {
      while (running) await running.catch(() => {})
    },
    /** Re-scan every collection, or one; "Rebuild index" passes `fromScratch`. */
    async rescan(fromScratch: boolean, collection?: string) {
      for (const state of await store.listCollections(collection)) {
        if (fromScratch) {
          await store.clearCollection(state.name)
          cache.drop(state.name)
        }
        await store.writeCollection({ ...state, backfillCursor: null, backfillDone: false })
      }
      kick()
    },
    progress(): IndexerProgress {
      return {
        phase,
        collections: deps.sources().map((s) => {
          const r = reconcile.get(s.collection)
          return {
            collection: s.collection,
            label: s.label ?? s.collection,
            scanned: r?.scanned ?? null,
            total: r?.total ?? null,
            reconciling: !!r,
          }
        }),
        pendingChanges,
        chunksPerSecond: chunksPerSecond(),
        lastError,
      }
    },
    /** Resolves when the current pass (if any) settles — tests and shutdown. */
    idle: () => running ?? Promise.resolve(),
  }
}

export type Indexer = ReturnType<typeof createIndexer>
