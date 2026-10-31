import { findCatalogModel, hasProviderPrefix, type CatalogModelConnection } from './model-lookup'
import type { CatalogModel } from './types'

/**
 * Whether a stored model route can run now, and on which connection.
 *
 * A route's identity is the pair (provider, model). Its connection id is a hint: the account it
 * last ran on. When that account was deleted, re-added under a new id, or lost its key, the route
 * still runs on another usable account of the same provider. It does not run on a different
 * provider, and a bare model id that several connected providers offer is ambiguous: the route
 * fails closed instead of crossing to whichever provider happens to come first.
 *
 * The one rule for every reader: the server picks the connection a run uses with it, and the UI
 * uses it to decide whether a chat can send, so the two cannot disagree.
 */
export type RouteReadiness =
  | { status: 'ready'; providerId: string; connectionId: string; rebound: boolean }
  | { status: 'no-model' }
  /** The model's provider has no usable connection; `providerId` is null when it is unknown. */
  | { status: 'no-connection'; providerId: string | null }
  | { status: 'ambiguous'; providerIds: string[] }

/** A connection as the route needs it: a provider, and whether its credential can be used. */
export interface RouteConnection extends CatalogModelConnection {
  /** False when the connection's key is missing or unreadable. Absent means usable. */
  usable?: boolean
}

export interface StoredRoute {
  modelId: string | null | undefined
  providerConnectionId?: string | null
}

/** The providers the catalog lists the model under. */
export function catalogOwners(
  catalog: readonly Pick<CatalogModel, 'id' | 'providerId'>[],
  modelId: string,
): Set<string> {
  const providers = new Set(catalog.map((model) => model.providerId))
  return new Set([...providers].filter((p) => findCatalogModel(catalog, p, modelId)))
}

/**
 * The provider a model belongs to when the stored connection cannot say: its catalog owner, or
 * for a live model the catalog does not list, the connected provider its id is namespaced by.
 */
export function owningProviders(
  catalog: readonly Pick<CatalogModel, 'id' | 'providerId'>[],
  connections: readonly RouteConnection[],
  modelId: string,
): Set<string> {
  const listed = catalogOwners(catalog, modelId)
  if (listed.size > 0) return listed
  return new Set(
    connections
      .map((c) => c.providerId)
      .filter((providerId) => hasProviderPrefix(modelId, providerId)),
  )
}

/**
 * Whether a provider owns the model: one the catalog lists it under, or for a live model the
 * catalog does not list, the provider its id is namespaced by. A bare id nobody lists has no owner.
 */
export function providerOwnsModel(
  catalog: readonly Pick<CatalogModel, 'id' | 'providerId'>[],
  providerId: string,
  modelId: string,
): boolean {
  const listed = catalogOwners(catalog, modelId)
  return listed.size > 0 ? listed.has(providerId) : hasProviderPrefix(modelId, providerId)
}

export function routeReadiness(
  route: StoredRoute,
  connections: readonly RouteConnection[],
  catalog: readonly Pick<CatalogModel, 'id' | 'providerId'>[],
): RouteReadiness {
  const modelId = route.modelId
  if (!modelId) return { status: 'no-model' }
  const usable = connections.filter((connection) => connection.usable !== false)

  // The account it last ran on, while it still exists, has a key and owns the model.
  const preferred = usable.find((connection) => connection.id === route.providerConnectionId)
  if (preferred && providerOwnsModel(catalog, preferred.providerId, modelId)) {
    return {
      status: 'ready',
      providerId: preferred.providerId,
      connectionId: preferred.id,
      rebound: false,
    }
  }

  const owners = owningProviders(catalog, connections, modelId)
  if (owners.size > 1) return { status: 'ambiguous', providerIds: [...owners].sort() }
  const providerId = [...owners][0] ?? null
  const account = providerId ? usable.find((c) => c.providerId === providerId) : undefined
  if (!providerId || !account) return { status: 'no-connection', providerId }
  return {
    status: 'ready',
    providerId,
    connectionId: account.id,
    rebound: account.id !== route.providerConnectionId,
  }
}

/** Whether the route can run now: the gate a composer and a run share. */
export const routeCanRun = (
  route: StoredRoute,
  connections: readonly RouteConnection[],
  catalog: readonly Pick<CatalogModel, 'id' | 'providerId'>[],
): boolean => routeReadiness(route, connections, catalog).status === 'ready'
