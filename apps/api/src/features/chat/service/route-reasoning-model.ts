import { findCatalogModel, findCatalogModelForConnection } from '@localixai/agent/catalog'
import type { ReasoningModel } from '@localixai/agent'
import type { ChatServiceDeps } from './context'

type RouteCatalogDeps = Pick<ChatServiceDeps, 'catalogService' | 'providerConnectionsService'>

/**
 * The catalog model a route names, resolved the way the picker resolves it: through the route's
 * connection when it names one, else by an unambiguous model id. Null when the catalog cannot
 * say, including when the catalog or the connections cannot be read.
 */
export async function catalogModelForRoute(
  deps: RouteCatalogDeps,
  userId: string,
  connectionId: string | null,
  modelId: string,
) {
  const catalog = await deps.catalogService.getCatalog().catch(() => null)
  if (!catalog) return null
  return connectionId
    ? findCatalogModelForConnection(
        catalog.models,
        (await deps.providerConnectionsService.listConnections(userId).catch(() => null))
          ?.connections ?? [],
        connectionId,
        modelId,
      )
    : findCatalogModel(catalog.models, null, modelId)
}

/**
 * The reasoning capability of the model a route names ({@link catalogModelForRoute}). Null when
 * the catalog cannot say — the caller then keeps the stated level and the runtime clamps it.
 */
export function routeReasoningModel(deps: RouteCatalogDeps) {
  return async (
    userId: string,
    connectionId: string | null,
    modelId: string,
  ): Promise<ReasoningModel | null> => {
    const model = await catalogModelForRoute(deps, userId, connectionId, modelId)
    return model
      ? { supportsReasoning: model.supportsReasoning, reasoningEfforts: model.reasoningEfforts }
      : null
  }
}
