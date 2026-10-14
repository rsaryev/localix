import useSWR from 'swr'
import type { CatalogModel, CatalogProvider } from '@localixai/agent/catalog'

import { backendClient } from '@/shared/api/client'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'

export type { CatalogModel }

export function useModelsCatalog() {
  const workItemVisible = useWorkItemVisible()
  // Don't hold a stale model list on the client. The server keeps one catalog build per
  // metadata revision (it rebuilds when the background provider-metadata refresh lands),
  // and the route answers a revalidation with a 304, so refetching is cheap — revalidate
  // on focus/reconnect so a new build (new models, reasoning levels, release order) shows
  // up without a hard refresh. Dedupe briefly to avoid refetch spam.
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

  return {
    models: data?.models ?? ([] as CatalogModel[]),
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
