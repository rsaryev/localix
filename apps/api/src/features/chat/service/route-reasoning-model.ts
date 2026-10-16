import { findCatalogModel, findCatalogModelForConnection } from '@localixai/agent/catalog'
import type { ReasoningModel } from '@localixai/agent'
import type { ChatServiceDeps } from './context'

/**
 * The reasoning capability of the model a route names, resolved the way the picker resolves it:
 * through the route's connection when it names one, else by an unambiguous model id. Null when
 * the catalog cannot say — the caller then keeps the stated level and the runtime clamps it.
 */
export function routeReasoningModel(
  deps: Pick<ChatServiceDeps, 'catalogService' | 'providerConnectionsService'>,
) {
  return async (
    userId: string,
    connectionId: string | null,
    modelId: string,
  ): Promise<ReasoningModel | null> => {
    const catalog = await deps.catalogService.getCatalog().catch(() => null)
    if (!catalog) return null
    const model = connectionId
      ? findCatalogModelForConnection(
          catalog.models,
          (await deps.providerConnectionsService.listConnections(userId).catch(() => null))
            ?.connections ?? [],
          connectionId,
          modelId,
        )
      : findCatalogModel(catalog.models, null, modelId)
    return model
      ? { supportsReasoning: model.supportsReasoning, reasoningEfforts: model.reasoningEfforts }
      : null
  }
}
