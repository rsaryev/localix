import type { ChatServiceDeps } from './context'
import { catalogModelForRoute } from './route-reasoning-model'
import type { StatusLineModelInfo } from './status-line-input'

/**
 * What the catalog says of the model a route names ({@link catalogModelForRoute}) — its display
 * name, context window and whether it reasons. Nothing for a model the catalog does not know.
 */
export function statusLineModelInfo(
  deps: Pick<ChatServiceDeps, 'catalogService' | 'providerConnectionsService'>,
) {
  return async (
    userId: string,
    route: { providerConnectionId: string | null; modelId: string },
  ): Promise<StatusLineModelInfo> => {
    if (!route.modelId) return {}
    const model = await catalogModelForRoute(
      deps,
      userId,
      route.providerConnectionId,
      route.modelId,
    )
    if (!model) return {}
    return {
      name: model.name,
      ...(model.contextLength ? { contextLength: model.contextLength } : {}),
      supportsReasoning: model.supportsReasoning,
    }
  }
}
