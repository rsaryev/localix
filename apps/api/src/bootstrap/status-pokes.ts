import type { LocalModelsService } from '../features/local-models/service'
import type { SemanticService } from '../features/embeddings/service'
import { startStatusPokes } from '../features/realtime/status-pokes'

/**
 * Local models, semantic search and the Store poke their client topics as their status moves (a
 * download, an index build, an install or update; plugin updates reach the Store through its
 * plugin provider), so the screens re-read it instead of polling. Stops with the process signal.
 */
export function startModelStatusPokes(deps: {
  localModels: Pick<LocalModelsService, 'subscribe'>
  semanticService: Pick<SemanticService, 'subscribe'>
  /** The Store: any provider's listings moved (`features/store/service.ts`). */
  store: {
    subscribe(listener: () => void): () => void
    /** A source was written or moved on its own (`features/store/store-runs.ts`). */
    subscribeSources(listener: () => void): () => void
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
    ],
    (resources) =>
      deps.chatService.streamRegistry.publish(deps.env.LOCALIX_DEFAULT_USER_ID, '', {
        type: 'resources.changed',
        resources,
      }),
  )
  deps.signal?.addEventListener('abort', stop, { once: true })
}
