/**
 * The READ half of the semantic index: query vectors in, ranked chunks out.
 *
 * `queryFor` is what a search strategy hands its providers: the query text is embedded once,
 * on the first provider that asks, and every later `similar` reuses that vector. A failure to
 * embed (the engine crashed mid-query) degrades that provider to its words-only answer rather
 * than failing the search.
 */
import type {
  SemanticMatch,
  SemanticQuery,
  SemanticSimilarOptions,
  SemanticTask,
  SemanticVectors,
} from '@localixai/plugin-sdk/backend'
import type { SemanticStore } from './store'
import type { VectorCache } from './vector-cache'

/** A meaning match must stand this many standard deviations above the collection. */
export const DEFAULT_Z_GATE = 2
/**
 * How long a search waits for its query vector. Under the search registry's per-provider
 * deadline (2.5 s), so a cold model start degrades the search to words instead of dropping the
 * provider. The embedding keeps running and lands in the engine's cache for the next keystroke.
 */
export const QUERY_VECTOR_BUDGET_MS = 1500
const DEFAULT_LIMIT = 50

export interface SemanticReader {
  similar(
    userId: string,
    collection: string,
    vector: Float32Array,
    options?: SemanticSimilarOptions,
  ): Promise<SemanticMatch[]>
  /** One query's semantic strategy. No vectors → null (lexical only). */
  queryFor(userId: string, text: string, task?: SemanticTask): SemanticQuery | null
  query(
    userId: string,
    collection: string,
    text: string,
    options?: SemanticSimilarOptions & { task?: SemanticTask },
  ): Promise<SemanticMatch[]>
}

export function createSemanticReader(deps: {
  store: Pick<SemanticStore, 'excerpts'>
  cache: VectorCache
  /** The vectors port (`semantic-vectors.ts`): the query's vector, like every other consumer's. */
  vectors: Pick<SemanticVectors, 'ready' | 'embed'>
  /** Test seam; default {@link QUERY_VECTOR_BUDGET_MS}. */
  queryBudgetMs?: number
}): SemanticReader {
  const { store, cache } = deps
  const budgetMs = deps.queryBudgetMs ?? QUERY_VECTOR_BUDGET_MS

  async function similar(
    userId: string,
    collection: string,
    vector: Float32Array,
    options: SemanticSimilarOptions = {},
  ): Promise<SemanticMatch[]> {
    const scope =
      options.scope === undefined
        ? undefined
        : new Set<string>(typeof options.scope === 'string' ? [options.scope] : options.scope)
    const ranked = await cache.rank(collection, userId, vector, {
      limit: options.limit ?? DEFAULT_LIMIT,
      scope,
      minZ: options.minZ,
    })
    const excerpts = await store.excerpts(ranked.map((r) => r.id))
    return ranked.map((r) => ({
      key: r.key,
      chunk: r.chunk,
      excerpt: excerpts.get(r.id) ?? '',
      z: r.z,
      gate: r.gate,
      cosine: r.cosine,
      scope: r.scope,
    }))
  }

  /** The query's vector, or null when the model cannot embed now. */
  const queryVector = async (text: string, task: SemanticTask) =>
    (await deps.vectors.embed([text], { role: 'query', task }))?.vectors[0] ?? null

  return {
    similar,
    queryFor(userId, text, task = 'search') {
      if (!deps.vectors.ready()) return null
      let vector: Promise<Float32Array | null> | null = null
      let missed = false
      const vectorOnce = () =>
        (vector ??= new Promise<Float32Array | null>((resolve) => {
          const timer = setTimeout(() => {
            missed = true
            resolve(null)
          }, budgetMs)
          timer.unref?.()
          queryVector(text, task).then(
            (v) => {
              clearTimeout(timer)
              if (!v) missed = true
              resolve(v)
            },
            () => {
              clearTimeout(timer)
              missed = true
              resolve(null)
            },
          )
        }))
      return {
        zGate: DEFAULT_Z_GATE,
        get missed() {
          return missed
        },
        async similar(collection, options) {
          const v = await vectorOnce()
          return v ? similar(userId, collection, v, options) : []
        },
      }
    },
    async query(userId, collection, text, options = {}) {
      const vector = await queryVector(text, options.task ?? 'search')
      return vector ? similar(userId, collection, vector, options) : []
    },
  }
}
