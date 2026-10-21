import type { ReasoningEffort } from '../../../model/reasoning'
import { findCatalogModel, routeReadiness, type CatalogModel } from '@localixai/agent/catalog'

export type ModelRoutingSlot = {
  providerConnectionId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
} | null

/** A workload always holds an explicit level: it never follows the conversation's. */
export function assignTaskModel(
  _slot: ModelRoutingSlot | undefined,
  providerConnectionId: string,
  modelId: string,
  reasoningEffort: ReasoningEffort,
): ModelRoutingSlot {
  return { providerConnectionId, modelId, reasoningEffort }
}

/**
 * The connection and catalog model a stored route resolves to today, by the one route rule
 * (`routeReadiness`): the stored connection while it owns the model, else another account of the
 * model's provider; an id several providers offer resolves to none. Key health is not asked here —
 * this names the model a route shows, and the composer's send gate asks it separately.
 */
export function liveRouteModel<
  TModel extends Pick<CatalogModel, 'id' | 'providerId'>,
  TConnection extends { id: string; providerId: string },
>(
  models: readonly TModel[],
  connections: readonly TConnection[],
  modelId: string | null | undefined,
  connectionId?: string | null,
): { connection: TConnection; model: TModel } | null {
  const route = routeReadiness({ modelId, providerConnectionId: connectionId }, connections, models)
  if (route.status !== 'ready') return null
  const connection = connections.find((candidate) => candidate.id === route.connectionId)
  const model = findCatalogModel(models, route.providerId, modelId)
  return connection && model ? { connection, model } : null
}

/** A workload's stored route resolved by {@link liveRouteModel}. */
export function resolveLiveTaskModel<
  TModel extends Pick<CatalogModel, 'id' | 'providerId'>,
  TConnection extends { id: string; providerId: string },
>(
  models: readonly TModel[],
  connections: readonly TConnection[],
  slot: ModelRoutingSlot,
): { connection: TConnection; model: TModel } | null {
  if (!slot) return null
  return liveRouteModel(models, connections, slot.modelId, slot.providerConnectionId)
}

/** The checkmark in one connection's list follows the active target, not the party's first row. */
export function selectedTaskModelId(
  live: { connection: { id: string }; model: { id: string } } | null,
  selectedConnectionId: string | null | undefined,
): string {
  return live && live.connection.id === selectedConnectionId ? live.model.id : ''
}
