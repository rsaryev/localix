import type { LocalModelsService } from '../features/local-models/service'
import type { SemanticService } from '../features/embeddings/service'
import { startStatusPokes } from '../features/realtime/status-pokes'

/**
 * Local models and semantic search poke their client topics as their status moves (a download,
 * an index build), so Settings re-reads it instead of polling. Stops with the process signal.
 */
export function startModelStatusPokes(deps: {
  localModels: Pick<LocalModelsService, 'subscribe'>
  semanticService: Pick<SemanticService, 'subscribe'>
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
    ],
    (resources) =>
      deps.chatService.streamRegistry.publish(deps.env.LOCALIX_DEFAULT_USER_ID, '', {
        type: 'resources.changed',
        resources,
      }),
  )
  deps.signal?.addEventListener('abort', stop, { once: true })
}
