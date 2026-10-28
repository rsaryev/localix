import { findCatalogModel, findCatalogModelForConnection } from '@localixai/agent/catalog'

import type { ChatServiceDeps } from './context'
import type { StatusLineModelInfo } from './status-line-input'

/**
 * What the catalog says of the model a route names — its display name, context window and whether
 * it reasons — resolved as the picker resolves it: through the route's connection when it names
 * one, else by an unambiguous model id. Nothing for a model the catalog does not know.
 */
export function statusLineModelInfo(
  deps: Pick<ChatServiceDeps, 'catalogService' | 'providerConnectionsService'>,
) {
  return async (
    userId: string,
    route: { providerConnectionId: string | null; modelId: string },
  ): Promise<StatusLineModelInfo> => {
    const catalog = await deps.catalogService.getCatalog().catch(() => null)
    if (!catalog || !route.modelId) return {}
    const model = route.providerConnectionId
      ? findCatalogModelForConnection(
          catalog.models,
          (await deps.providerConnectionsService.listConnections(userId).catch(() => null))
            ?.connections ?? [],
          route.providerConnectionId,
          route.modelId,
        )
      : findCatalogModel(catalog.models, null, route.modelId)
    if (!model) return {}
    return {
      name: model.name,
      ...(model.contextLength ? { contextLength: model.contextLength } : {}),
      supportsReasoning: model.supportsReasoning,
    }
  }
}
