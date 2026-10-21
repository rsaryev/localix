import { useMemo } from 'react'

import { providerOffersChat } from '@localixai/agent/catalog'
import type { CatalogModel, ProviderEntry } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'

export interface ModelSelectProvidersParams {
  models: CatalogModel[]
  allProviders: ProviderEntry[]
  oauthProviderIds: string[]
  connections: ProviderConnection[]
  deferredSearch: string
}

export interface ModelSelectProviders {
  /** providerId → number of catalog models it offers. */
  providerCounts: Record<string, number>
  oauthIdSet: ReadonlySet<string>
  /** Providers with no connection yet, in catalog order. */
  unconnectedProviders: ProviderEntry[]
  /** unconnectedProviders narrowed by the current search query. */
  filteredUnconnectedProviders: ProviderEntry[]
}

/**
 * The providers "Add Provider" offers: not yet connected, and able to serve a chat model.
 *
 * A provider with no chat models (a classifier-only one) used to be offered, took a key, and then
 * showed an empty model list. The catalog service owns provider ordering; filtering is stable,
 * so this never duplicates that policy.
 */
export function connectableProviders(
  allProviders: readonly ProviderEntry[],
  connections: readonly Pick<ProviderConnection, 'providerId'>[],
): ProviderEntry[] {
  const connectedIds = new Set(connections.map((c) => c.providerId))
  return allProviders.filter((p) => !connectedIds.has(p.id) && providerOffersChat(p))
}

/**
 * Derives the model-picker's provider lists: per-provider model counts, the
 * OAuth-capable id set, and the unconnected-provider list (in catalog
 * order) filtered by search. Pure projection — extracted from
 * ModelSearchSelect so the component keeps selection/UI state.
 */
export function useModelSelectProviders({
  models,
  allProviders,
  oauthProviderIds,
  connections,
  deferredSearch,
}: ModelSelectProvidersParams): ModelSelectProviders {
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of models) {
      if (m.providerId) counts[m.providerId] = (counts[m.providerId] || 0) + 1
    }
    return counts
  }, [models])

  const oauthIdSet = useMemo(() => new Set(oauthProviderIds), [oauthProviderIds])

  const unconnectedProviders = useMemo(
    () => connectableProviders(allProviders, connections),
    [allProviders, connections],
  )

  const filteredUnconnectedProviders = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return unconnectedProviders
    return unconnectedProviders.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    )
  }, [unconnectedProviders, deferredSearch])

  return { providerCounts, oauthIdSet, unconnectedProviders, filteredUnconnectedProviders }
}
