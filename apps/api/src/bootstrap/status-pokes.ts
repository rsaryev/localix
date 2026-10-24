import type { LocalModelsService } from '../features/local-models/service'
import type { SemanticService } from '../features/embeddings/service'
import { startStatusPokes } from '../features/realtime/status-pokes'

/**
 * Local models, semantic search, the mini app store and plugin updates poke their client topics as
 * their status moves (a download, an index build, an install, an update), so the screens re-read it instead of polling. Stops with the process signal.
 */
export function startModelStatusPokes(deps: {
  localModels: Pick<LocalModelsService, 'subscribe'>
  semanticService: Pick<SemanticService, 'subscribe'>
  /** The mini app store's installs in flight (`mini-apps/store.ts`). */
  miniAppStore: { subscribe(listener: () => void): () => void }
  /** The Store: any provider's listings moved (`features/store/service.ts`). */
  store: { subscribe(listener: () => void): () => void }
  /** Plugin updates available and in flight (`plugins/plugin-updates.ts`). */
  pluginUpdates: { subscribe(listener: () => void): () => void }
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
      { resource: 'mini-app-installs', subscribe: deps.miniAppStore.subscribe },
      { resource: 'store', subscribe: deps.store.subscribe },
      { resource: 'plugin-updates', subscribe: deps.pluginUpdates.subscribe },
    ],
    (resources) =>
      deps.chatService.streamRegistry.publish(deps.env.LOCALIX_DEFAULT_USER_ID, '', {
        type: 'resources.changed',
        resources,
      }),
  )
  deps.signal?.addEventListener('abort', stop, { once: true })
}
