import type { LocalModelsService } from '../features/local-models/service'
import type { SemanticService } from '../features/embeddings/service'
import { startStatusPokes } from '../features/realtime/status-pokes'

/**
 * Local models, semantic search and the Store poke their client topics as their status moves (a
 * download, an index build, an install or update; plugin updates reach the Store through its
 * plugin provider; a background recommendation answer), so the screens re-read it instead of
 * polling. Stops with the process signal.
 */
export function startModelStatusPokes(deps: {
  localModels: Pick<LocalModelsService, 'subscribe'>
  semanticService: Pick<SemanticService, 'subscribe'>
  /** The Store: any provider's listings moved (`features/store/service.ts`). */
  store: {
    subscribe(listener: () => void): () => void
    /** A source was written or moved on its own (`features/store/store-runs.ts`). */
    subscribeSources(listener: () => void): () => void
    /** A background recommendation answer moved (`features/store/recommend-board.ts`). */
    subscribeRecommendations(listener: () => void): () => void
    /** How the Store searches changed: the recommendations are worked out again. */
    refreshRecommendations(): void
  }
  chatService: {
    streamRegistry: { publish(userId: string, sessionId: string, event: unknown): void }
  }
  env: { LOCALIX_DEFAULT_USER_ID: string }
  signal?: AbortSignal
}): void {
  const stop = startStatusPokes(
    [
      { resource: 'local-models', subscribe: deps.localModels.subscribe },
      { resource: 'semantic', subscribe: deps.semanticService.subscribe },
      { resource: 'store', subscribe: (...args) => deps.store.subscribe(...args) },
      { resource: 'store-sources', subscribe: (...args) => deps.store.subscribeSources(...args) },
      {
        resource: 'store-recommendations',
        subscribe: (...args) => deps.store.subscribeRecommendations(...args),
      },
    ],
    (resources) =>
      deps.chatService.streamRegistry.publish(deps.env.LOCALIX_DEFAULT_USER_ID, '', {
        type: 'resources.changed',
        resources,
      }),
  )
  // The meaning model getting ready (or parked) changes what a recommendation can find; the
  // answers that moved poke their own topic.
  const stopRefresh = deps.semanticService.subscribe(() => deps.store.refreshRecommendations())
  deps.signal?.addEventListener(
    'abort',
    () => {
      stop()
      stopRefresh()
    },
    { once: true },
  )
}
