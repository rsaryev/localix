/**
 * Semantic search, composed: the embedding engine, the indexer and the source registry.
 *
 * Always on, always with EmbeddingGemma 2 — a model Localix keeps on this computer
 * (`local-models/pinned.ts`, `REQUIRED_MODELS`); there is no switch and no model to choose. Until
 * the model is here (downloading) or while its engine cannot run, search answers from words
 * alone; the moment it is installed, indexing starts and `strategy()` tells search to fuse
 * meaning with words. The indexer keeps every registered source's collection current (from the
 * change feed). Downloads and the model server belong to `features/local-models`.
 */
import type { SemanticSource } from '@localixai/plugin-sdk/backend'
import type { LocalModelsService } from '../local-models/service'
import type { SemanticStatus, SearchStrategyNote } from './contracts'
import { createEmbeddingEngine, type EmbeddingBackend, type EmbeddingEngine } from './engine'
import { createIndexer } from './indexer'
import { removeKeys } from './ingest'
import { EMBEDDINGGEMMA_2, type EmbeddingModelSpec } from './models'
import { routerEmbeddingBackend } from './router-backend'
import { createSemanticReader } from './semantic-index'
import type { SemanticStore } from './store'
import { buildSemanticStatus } from './semantic-status'
import { createVectorCache } from './vector-cache'

export interface SemanticServiceDeps {
  store: SemanticStore
  localModels: Pick<
    LocalModelsService,
    'isInstalled' | 'background' | 'job' | 'router' | 'status' | 'subscribe'
  >
  log?: (event: string, fields: Record<string, unknown>) => void
  /** Test seams. */
  model?: EmbeddingModelSpec
  backend?: (model: EmbeddingModelSpec) => EmbeddingBackend
}

const HOUSEKEEPING_MS = 60_000
/** A failed engine is tried again this long after it parked: nobody is asked to press a button. */
const ENGINE_RETRY_MS = 5 * 60_000

export function createSemanticService(deps: SemanticServiceDeps) {
  const { store, localModels } = deps
  const model: EmbeddingModelSpec = deps.model ?? EMBEDDINGGEMMA_2
  /** Set by `boot()`, post-listen: nothing is embedded before the API serves. */
  let booted = false
  let engine: EmbeddingEngine | null = null
  let engineRetry: ReturnType<typeof setTimeout> | null = null
  const sources = new Map<string, SemanticSource>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())
  localModels.subscribe(() => {
    // The model arrived (fetched in the background): index with it.
    if (booted && !engine && installed()) {
      activate()
      void indexer.rescan(false)
    }
    notify()
  })

  const cache = createVectorCache(store, () => model.indexDimensions)
  const indexer = createIndexer({
    store,
    cache,
    sources: () => [...sources.values()],
    onProgress: notify,
    log: deps.log,
  })
  const reader = createSemanticReader({ store, cache, engine: () => usableEngine() })
  const housekeeping = setInterval(() => cache.releaseIdle(), HOUSEKEEPING_MS)
  housekeeping.unref?.()

  const installed = () => localModels.isInstalled(model.id)

  function backendFor(spec: EmbeddingModelSpec): EmbeddingBackend {
    return deps.backend ? deps.backend(spec) : routerEmbeddingBackend(localModels.router, spec.id)
  }

  /** The engine search may use: installed, and not parked in a failed state. */
  function usableEngine(): EmbeddingEngine | null {
    if (!engine || engine.state().state === 'error') return null
    return engine
  }

  /** A parked engine starts again on its own; search answers from words until it does. */
  function onEngineState() {
    if (engine?.state().state === 'error' && !engineRetry) {
      engineRetry = setTimeout(() => {
        engineRetry = null
        engine?.reset()
        indexer.kick()
      }, ENGINE_RETRY_MS)
      engineRetry.unref?.()
    }
    notify()
  }

  function activate() {
    if (!booted || engine || !installed()) return
    const spec = model
    const backend = backendFor(spec)
    engine = createEmbeddingEngine(
      { model: spec, start: async () => backend },
      { onStateChange: onEngineState },
    )
    indexer.start(engine)
    notify()
  }

  async function deactivate() {
    const running = engine
    engine = null
    await indexer.stop()
    await running?.stop()
    cache.drop()
    notify()
  }

  return {
    /** Start indexing once the model is here. Boot, post-listen. */
    async boot() {
      booted = true
      activate()
      // Indexing used to have an off switch, and changes made while it was off reached no
      // outbox: an index left behind by it is compared in full once, then marked on for good.
      const stored = await store.readSettings()
      if (!stored.enabled) {
        await store.writeSettings({ ...stored, enabled: true })
        if (engine) void indexer.rescan(false)
      }
    },

    async rebuild() {
      indexer.resume()
      await indexer.rescan(true)
    },

    /** Hold indexing (search keeps answering from what is indexed); `resume` continues it. */
    async pause() {
      await indexer.pause()
    },
    resume() {
      indexer.resume()
    },

    /** Leave a failed engine state and try again (and retry a failed download). */
    async retry() {
      engine?.reset()
      localModels.background.reconcile({ retry: true })
      indexer.kick()
      notify()
    },

    prewarm() {
      usableEngine()?.prewarm()
    },

    registerSource(source: SemanticSource): () => void {
      if (sources.has(source.collection)) {
        throw new Error(`semantic source "${source.collection}" is already registered`)
      }
      sources.set(source.collection, source)
      indexer.kick()
      return () => {
        if (sources.get(source.collection) === source) sources.delete(source.collection)
      }
    },

    async changed(collection: string, keys: readonly string[]) {
      if (keys.length === 0) return
      await store.enqueue(collection, keys)
      indexer.kick()
    },

    /** Anything in `collection` may have changed: reconcile it. */
    async resync(collection: string) {
      await indexer.rescan(false, collection)
    },

    /**
     * `parent` was deleted, and every item under it with it: drop their vectors, so a deleted chat
     * never leaves its messages' vectors behind.
     */
    async removeUnder(collection: string, parent: string) {
      await removeKeys({ store, cache }, collection, await store.keysUnder(collection, parent))
    },

    reader,

    /** What the next search will use, and why when it is not meaning-aware. */
    strategy(): SearchStrategyNote {
      if (!installed()) return { mode: 'lexical', reason: 'not-installed' }
      if (!usableEngine()) return { mode: 'lexical', reason: 'unavailable' }
      const progress = indexer.progress()
      return { mode: 'hybrid', ...(progress.phase === 'reconciling' ? { indexing: true } : {}) }
    },

    model: () => model,
    /** The engine search may use right now, or null. */
    engine: () => usableEngine(),

    async status(): Promise<SemanticStatus> {
      return buildSemanticStatus({
        model,
        installed: installed(),
        counts: await store.counts(),
        progress: indexer.progress(),
        pending: await store.outboxSize(),
        local: await localModels.status(),
        job: localModels.job(model.id),
        engine: engine?.state() ?? { state: 'idle', error: null },
      })
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async shutdown() {
      clearInterval(housekeeping)
      if (engineRetry) clearTimeout(engineRetry)
      await deactivate()
    },

    /** Test seam: wait for the indexer's current pass. */
    settle: () => indexer.idle(),
  }
}

export type SemanticService = ReturnType<typeof createSemanticService>
