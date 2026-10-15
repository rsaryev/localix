import type { ReasoningEffort } from '../../../model/reasoning'
import { resolveLiveCatalogModel, type CatalogModel } from '@localixai/agent/catalog'

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
 * Resolve a stored route against today's connections. Exact connection wins;
 * a namespaced model can recover its provider after that connection is deleted
 * and use another live connection of the same provider.
 */
export function resolveLiveTaskModel<
  TModel extends Pick<CatalogModel, 'id' | 'providerId'>,
  TConnection extends { id: string; providerId: string },
>(
  models: readonly TModel[],
  connections: readonly TConnection[],
  slot: ModelRoutingSlot,
): { connection: TConnection; model: TModel } | null {
  if (!slot) return null
  return resolveLiveCatalogModel(models, connections, slot.modelId, slot.providerConnectionId)
}

/** The checkmark in one connection's list follows the active target, not the party's first row. */
export function selectedTaskModelId(
  live: { connection: { id: string }; model: { id: string } } | null,
  selectedConnectionId: string | null | undefined,
): string {
  return live && live.connection.id === selectedConnectionId ? live.model.id : ''
}
