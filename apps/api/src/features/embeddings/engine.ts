/**
 * The embedding engine: one model, one backend process, two lanes.
 *
 * QUERY lane — a person is typing. Never waits behind indexing: the indexer sends small
 * batches one at a time, and the server has parallel slots, so a query rides beside at most
 * one in-flight batch. Query vectors are cached (LRU), so the final search after a typing
 * pause usually finds the vector already computed by `prewarm`/an earlier keystroke.
 *
 * DOCUMENT lane — the indexer. One batch in flight; callers queue.
 *
 * The backend starts on first use and stops after `idleMs` without requests, which returns
 * its ~400 MB to the system. A crash is reported once and the next request restarts it; three
 * failed starts in a row park the engine in `error` until `reset()` (Settings "Try again").
 */
import type { SemanticTask } from '@localixai/plugin-sdk/backend'
import { createBoundedCache } from '../../lib/bounded-cache'
import { modelFingerprint, type EmbeddingModelSpec } from './models'
import { isFiniteVector, truncateNormalize } from './vectors'

export type EngineState = 'idle' | 'starting' | 'ready' | 'error'

/** Where vectors come from: raw model vectors (already L2-normalized), one per input. */
export interface EmbeddingBackend {
  embed(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]>
  stop(): Promise<void>
  readonly running: boolean
}

export interface EngineTarget {
  model: EmbeddingModelSpec
  start(onExit: (reason: string) => void): Promise<EmbeddingBackend>
}

export interface EmbeddingEngine {
  readonly model: EmbeddingModelSpec
  readonly fingerprint: string
  state(): { state: EngineState; error: string | null }
  embedQuery(text: string, task?: SemanticTask): Promise<Float32Array>
  embedDocuments(
    docs: ReadonlyArray<{ text: string; title?: string; task?: SemanticTask }>,
  ): Promise<Float32Array[]>
  /** Start the backend now (search opened) so the first query does not pay the start. */
  prewarm(): void
  /** Leave `error` and allow a new start. */
  reset(): void
  stop(): Promise<void>
}

const QUERY_CACHE_SIZE = 256
const DEFAULT_IDLE_MS = 5 * 60_000
const MAX_FAILED_STARTS = 3

export function createEmbeddingEngine(
  target: EngineTarget,
  options: { idleMs?: number; onStateChange?(): void } = {},
): EmbeddingEngine {
  const { model } = target
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const queryCache = createBoundedCache<string, Float32Array>({ maxEntries: QUERY_CACHE_SIZE })
  let backend: EmbeddingBackend | null = null
  let starting: Promise<EmbeddingBackend> | null = null
  let state: EngineState = 'idle'
  let lastError: string | null = null
  let failedStarts = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let documentLane: Promise<unknown> = Promise.resolve()
  let inFlight = 0

  const setState = (next: EngineState, error: string | null = lastError) => {
    if (next === state && error === lastError) return
    state = next
    lastError = error
    options.onStateChange?.()
  }

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (inFlight > 0) return armIdle()
      void stopBackend()
    }, idleMs)
    idleTimer.unref?.()
  }

  async function stopBackend() {
    const running = backend
    backend = null
    if (running) await running.stop()
    if (state === 'ready') setState('idle')
  }

  async function ensureBackend(): Promise<EmbeddingBackend> {
    if (backend?.running) return backend
    if (state === 'error' && failedStarts >= MAX_FAILED_STARTS) {
      throw new Error(lastError ?? 'The embedding engine could not start')
    }
    if (!starting) {
      setState('starting', null)
      starting = target
        .start((reason) => {
          backend = null
          queryCache.clear()
          setState('error', reason)
        })
        .then((started) => {
          backend = started
          failedStarts = 0
          setState('ready', null)
          return started
        })
        .catch((err: unknown) => {
          failedStarts += 1
          setState('error', err instanceof Error ? err.message : String(err))
          throw err
        })
        .finally(() => {
          starting = null
        })
    }
    return starting
  }

  async function run(inputs: string[]): Promise<Float32Array[]> {
    inFlight += 1
    try {
      const raw = await (await ensureBackend()).embed(inputs)
      return raw.map((vector) => {
        if (!isFiniteVector(vector)) throw new Error('the model returned a non-finite vector')
        return truncateNormalize(vector, model.indexDimensions)
      })
    } finally {
      inFlight -= 1
      armIdle()
    }
  }

  const clip = (text: string) => text.slice(0, model.maxChunkChars * 2)

  return {
    model,
    fingerprint: modelFingerprint(model),
    state: () => ({ state, error: lastError }),
    async embedQuery(text, task = 'search') {
      const key = `${task}\u0000${text}`
      const cached = queryCache.get(key)
      if (cached) return cached
      const [vector] = await run([model.formatQuery(task, clip(text))])
      queryCache.set(key, vector!)
      return vector!
    },
    embedDocuments(docs) {
      const inputs = docs.map((d) =>
        model.formatDocument(d.task ?? 'search', d.title, clip(d.text)),
      )
      const result = documentLane.then(() => run(inputs))
      documentLane = result.catch(() => {})
      return result
    },
    prewarm() {
      void ensureBackend()
        .then(armIdle)
        .catch(() => {})
    },
    reset() {
      failedStarts = 0
      if (state === 'error') setState('idle', null)
    },
    async stop() {
      if (idleTimer) clearTimeout(idleTimer)
      await starting?.catch(() => {})
      await stopBackend()
    },
  }
}
