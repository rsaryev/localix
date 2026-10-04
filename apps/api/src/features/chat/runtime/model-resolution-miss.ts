import type { ModelUnavailableReason } from '@localixai/agent/agents'
import type { CatalogModel, CatalogProvider } from '@localixai/agent/catalog'
import { findCatalogModel } from '@localixai/agent/catalog'

import { hasProviderPrefix } from './model-resolution'
import { firstEnabledKey } from './provider-keys'

/**
 * WHY a chosen model could not be bound, once `resolveLanguageModel` answered null.
 *
 * The resolver fails closed to one `null`, and the run turned every null into the same
 * "No usable provider connection" — so a model the catalog had dropped, a provider whose keys were
 * all disabled, and a connection whose credential would not load all read alike, and the
 * composer's "Select model" said nothing either. The fix for each is different, so this names the
 * step that failed, from the same inputs the resolver had, and only on the failure path.
 *
 * Decided in the order the resolver needs its facts: an owner in the catalog, then a connection
 * with an enabled key for that owner, then its credential. The first missing fact is the reason.
 */

export interface ModelMiss {
  reason: ModelUnavailableReason
  message: string
}

interface MissConnection {
  id: string
  providerId: string
  keys: readonly { enabled: boolean; priority: number }[]
}

export function diagnoseModelMiss(input: {
  modelId: string
  /** Undefined when the catalog could not be read — nothing can then be said about ownership. */
  catalog:
    | {
        models: readonly Pick<CatalogModel, 'id' | 'providerId'>[]
        providers: readonly Pick<CatalogProvider, 'id' | 'name'>[]
      }
    | undefined
  connections: readonly MissConnection[]
  preferredConnectionId?: string | null
}): ModelMiss {
  const { modelId, catalog, connections } = input
  const owners = catalog
    ? [...new Set(catalog.models.map((model) => model.providerId))].filter((providerId) =>
        findCatalogModel(catalog.models, providerId, modelId),
      )
    : []

  if (catalog && owners.length === 0) {
    return {
      reason: 'model_not_in_catalog',
      message: `Model "${modelId}" is no longer available. Choose another model.`,
    }
  }

  // Without a catalog, a namespaced id still names its provider.
  const candidates =
    owners.length > 0
      ? owners
      : [...new Set(connections.map((connection) => connection.providerId))].filter((providerId) =>
          hasProviderPrefix(modelId, providerId),
        )
  const preferred = connections.find((connection) => connection.id === input.preferredConnectionId)
  const ordered =
    preferred && candidates.includes(preferred.providerId)
      ? [preferred.providerId, ...candidates.filter((id) => id !== preferred.providerId)]
      : candidates
  const nameOf = (providerId: string) =>
    catalog?.providers.find((provider) => provider.id === providerId)?.name ?? providerId

  const keyed = ordered.filter((providerId) =>
    connections.some(
      (connection) => connection.providerId === providerId && firstEnabledKey(connection.keys),
    ),
  )
  if (keyed.length === 0) {
    const names = (ordered.length > 0 ? ordered : [modelId.split('/')[0] ?? modelId]).map(nameOf)
    const name = names.join(' or ')
    return {
      reason: 'no_enabled_key',
      message: `No enabled key for ${name}. Connect ${name} or enable one of its keys.`,
    }
  }

  const name = nameOf(keyed[0]!)
  return {
    reason: 'credential_unavailable',
    message: `Could not load the credential for ${name}. Sign in again or re-add its key.`,
  }
}
