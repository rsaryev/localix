import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'
import type { ResolvedModelEntry } from './CrossConnectionModelList'

/**
 * Resolve remembered (connectionId, modelId) pairs — Recent and Favorites — against the live
 * connections and catalog. A stale entry (its connection removed, its model gone) drops out.
 *
 * The two lists resolved this way in two hand-copied blocks; one function keeps them from
 * deciding "still valid" differently.
 */
export function resolveModelEntries(
  entries: readonly { connectionId: string; modelId: string }[],
  models: CatalogModel[],
  connections: ProviderConnection[],
): ResolvedModelEntry[] {
  const byId = new Map(connections.map((c) => [c.id, c]))
  return entries.flatMap((entry) => {
    const conn = byId.get(entry.connectionId)
    const model = findCatalogModelForConnection(
      models,
      connections,
      entry.connectionId,
      entry.modelId,
    )
    return conn && model
      ? [{ connectionId: conn.id, providerId: conn.providerId, connectionLabel: conn.label, model }]
      : []
  })
}

/** The model search, applied to a resolved list: by display name or id. */
export function searchModelEntries(
  entries: ResolvedModelEntry[],
  search: string,
): ResolvedModelEntry[] {
  const q = search.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(
    (item) => item.model.name.toLowerCase().includes(q) || item.model.id.toLowerCase().includes(q),
  )
}
