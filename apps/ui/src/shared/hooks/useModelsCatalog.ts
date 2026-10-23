import useSWR from 'swr'
import { useMemo } from 'react'
import { modelKindOf, type CatalogModel, type CatalogProvider } from '@localixai/agent/catalog'

import { backendClient } from '@/shared/api/client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

export type { CatalogModel }

const NO_MODELS: CatalogModel[] = []

export function useModelsCatalog() {
  const workItemVisible = useWorkItemVisible()
  // Don't hold a stale model list on the client. The server keeps one catalog build per
  // metadata revision (it rebuilds when the background provider-metadata refresh lands),
  // and the route answers a revalidation with a 304, so refetching is cheap — revalidate
  // on focus/reconnect so a new build (new models, reasoning levels, release order) shows
  // up without a hard refresh. Dedupe briefly to avoid refetch spam.
  // A connection added or removed changes which providers and models the catalog answers with.
  useRevalidateOnResources('catalog', ['providers'])
  const { data, isLoading, error, mutate } = useSWR(
    workItemVisible ? 'catalog' : null,
    () => backendClient.getCatalog(),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      revalidateIfStale: true,
      dedupingInterval: 30_000,
    },
  )

  const all = data?.models
  // One catalog lists every kind (decision models for group routing); every client surface lists
  // chat models.
  const chat = useMemo(() => (all ?? []).filter((model) => modelKindOf(model) === 'chat'), [all])

  return {
    /** Chat models: what every chat surface lists. */
    models: all ? chat : NO_MODELS,
    providers: data?.providers ?? ([] as CatalogProvider[]),
    oauthProviderIds: data?.oauthProviderIds ?? ([] as string[]),
    oauthProviders: data?.oauthProviders ?? [],
    isLoading,
    /** Truthy when the catalog fetch failed (lets callers show a retry, not an empty list). */
    error,
    /** Re-run the catalog fetch (SWR revalidate). */
    refetch: workItemVisible ? mutate : () => Promise.resolve(undefined),
  }
}
