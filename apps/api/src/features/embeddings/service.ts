/**
 * Semantic search, composed: settings, the embedding engine, the indexer and the source registry.
 *
 * On by default, with EmbeddingGemma 2: while on, its local model is wanted, and local models
 * fetch it quietly in the background (`local-models/background.ts`); until it is here, search
 * answers from words alone, and the moment it is installed, indexing starts. Turning it off
 * stops wanting the model (its background download pauses). While on and installed, an engine
 * exists, the indexer keeps every registered source's collection current, and `strategy()`
 * tells search to fuse meaning with words. While off, the change-capture triggers are inert and
 * search is exactly lexical. Download, files and the server process belong to
 * `features/local-models`.
 */
import type { SemanticSource } from '@localixai/plugin-sdk/backend'
import type { LocalModelsService } from '../local-models/service'
import type { SemanticStatus, SearchStrategyNote } from './contracts'
import { createEmbeddingEngine, type EmbeddingBackend, type EmbeddingEngine } from './engine'
import { createIndexer } from './indexer'
import {
  EMBEDDINGGEMMA_2,
  localEmbeddingModel,
  providerEmbeddingModel,
  type EmbeddingModelSpec,
} from './models'
import { providerEmbeddingBackend } from './provider-backend'
import { routerEmbeddingBackend } from './router-backend'
import { createSemanticReader } from './semantic-index'
import type { SemanticStore } from './store'
import { createEmbeddingChoices } from './choices'
import type { EmbeddingChoice } from './contracts'
import { buildSemanticStatus } from './semantic-status'
import { createVectorCache } from './vector-cache'

export interface SemanticServiceDeps {
  store: SemanticStore
  localModels: Pick<
    LocalModelsService,
    'isInstalled' | 'background' | 'job' | 'remove' | 'router' | 'status' | 'subscribe'
  > & { catalog: Pick<LocalModelsService['catalog'], 'resolve' | 'list'> }
  /** The API keys `userId` connected embedding-capable providers with. */
  providerKeys?: (userId: string) => Promise<Map<string, string>>
  log?: (event: string, fields: Record<string, unknown>) => void
  /** Test seams. */
  model?: EmbeddingModelSpec
  backend?: (model: EmbeddingModelSpec) => EmbeddingBackend
}

const HOUSEKEEPING_MS = 60_000

export function createSemanticService(deps: SemanticServiceDeps) {
  const { store, localModels } = deps
  let model: EmbeddingModelSpec = deps.model ?? EMBEDDINGGEMMA_2
  /** Who chose a provider model: their connection's key embeds. Null for a local model. */
  let owner: string | null = null
  let enabled = false
  let engine: EmbeddingEngine | null = null
  const sources = new Map<string, SemanticSource>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())
  localModels.subscribe(() => {
    // The wanted model arrived (fetched in the background, or by a person): index with it.
    if (enabled && !engine && installed()) {
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

  const choices = createEmbeddingChoices({
    localModels,
    providerKeys: deps.providerKeys ?? (async () => new Map()),
  })
  const installed = () => model.source.kind !== 'local' || localModels.isInstalled(model.id)
  const settings = () => ({ enabled, modelId: model.id, ownerUserId: owner })

  /** A stored or picked id as a model: a provider's, the default, or a local catalog entry. */
  async function resolveModel(id: string | null): Promise<EmbeddingModelSpec | null> {
    if (!id || id === EMBEDDINGGEMMA_2.id) return EMBEDDINGGEMMA_2
    const provider = providerEmbeddingModel(id)
    if (provider) return provider
    const local = await localModels.catalog.resolve(id).catch(() => null)
    return local ? localEmbeddingModel(local) : null
  }

  function backendFor(spec: EmbeddingModelSpec): EmbeddingBackend {
    if (deps.backend) return deps.backend(spec)
    const { source } = spec
    if (source.kind === 'local') return routerEmbeddingBackend(localModels.router, spec.id)
    return providerEmbeddingBackend(spec, async () =>
      owner && deps.providerKeys
        ? ((await deps.providerKeys(owner).catch(() => null))?.get(source.providerId) ?? null)
        : null,
    )
  }

  /** The engine search may use: on, installed, and not parked in a failed state. */
  function usableEngine(): EmbeddingEngine | null {
    if (!engine || engine.state().state === 'error') return null
    return engine
  }

  function activate() {
    if (!enabled || engine || !installed()) return
    const spec = model
    const backend = backendFor(spec)
    engine = createEmbeddingEngine(
      { model: spec, start: async () => backend },
      { onStateChange: notify },
    )
    indexer.start(engine)
    notify()
  }

  /** While on, a local model is wanted on this computer; local models fetch it if missing. */
  const wantedModels = () => (enabled && model.source.kind === 'local' ? [model.source.local] : [])
  localModels.background.declare('semantic-search', wantedModels)

  async function deactivate() {
    const running = engine
    engine = null
    await indexer.stop()
    await running?.stop()
    cache.drop()
    notify()
  }

  return {
    /** Read the stored choice and start indexing when it is on. Boot, post-listen. */
    async boot() {
      const stored = await store.readSettings()
      if (!deps.model) model = (await resolveModel(stored.modelId)) ?? model
      owner = stored.ownerUserId
      enabled = stored.enabled
      activate()
      localModels.background.reconcile()
    },

    /** Turn on; a missing local model is fetched in the background. Resolves once accepted. */
    async enable() {
      enabled = true
      await store.writeSettings(settings())
      localModels.background.reconcile()
      if (installed()) {
        activate()
        // Changes made while indexing was off reached no outbox: compare everything once.
        await indexer.rescan(false)
      }
      notify()
    },

    async disable() {
      enabled = false
      await store.writeSettings(settings())
      localModels.background.reconcile()
      await deactivate()
    },

    /** The embedding models it can be set to: this computer's and `userId`'s providers'. */
    models: (userId: string): Promise<EmbeddingChoice[]> => choices.list(userId, model.id),

    /**
     * Embed with another model. Its vectors live in another space, so the index is rebuilt with
     * it (the old one is dropped at the first pass); a missing local model is fetched first.
     */
    async setModel(id: string, userId: string) {
      const next = await resolveModel(id)
      if (!next) throw new Error(`Unknown embedding model "${id}"`)
      const nextOwner = next.source.kind === 'provider' ? userId : null
      if (next.id === model.id && nextOwner === owner) return
      await deactivate()
      model = next
      owner = nextOwner
      await store.writeSettings(settings())
      localModels.background.reconcile()
      activate()
      notify()
    },

    /** Delete the model's files and every vector made with it. */
    async removeModel() {
      if (model.source.kind !== 'local') return
      await this.disable()
      await localModels.remove(model.id)
      for (const state of await store.listCollections()) await store.clearCollection(state.name)
      await store.clearOutbox()
      notify()
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
      if (!enabled || keys.length === 0) return
      await store.enqueue(collection, keys)
      indexer.kick()
    },

    reader,

    /** What the next search will use, and why when it is not meaning-aware. */
    strategy(): SearchStrategyNote {
      if (!enabled) return { mode: 'lexical', reason: 'off' }
      if (!installed()) return { mode: 'lexical', reason: 'not-installed' }
      if (!usableEngine()) return { mode: 'lexical', reason: 'unavailable' }
      const progress = indexer.progress()
      return { mode: 'hybrid', ...(progress.phase === 'reconciling' ? { indexing: true } : {}) }
    },

    enabled: () => enabled,
    model: () => model,
    /** The engine search may use right now, or null. */
    engine: () => usableEngine(),

    async status(): Promise<SemanticStatus> {
      return buildSemanticStatus({
        enabled,
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
      await deactivate()
    },

    /** Test seam: wait for the indexer's current pass. */
    settle: () => indexer.idle(),
  }
}

export type SemanticService = ReturnType<typeof createSemanticService>
