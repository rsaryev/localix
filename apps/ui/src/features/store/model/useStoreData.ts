import useSWR from 'swr'
import type { ListingRef, Scope } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import { useResourceGeneration } from '@/shared/api/resourceGeneration'

/**
 * The Store's reads. Each key carries the `store` poke's generation, so a poke — a job moved, an
 * install or a source changed — reads again; nothing here patches what the server said (P11).
 */

export function useStoreListings(client: StoreClient, query: { shelf?: string; q?: string }) {
  const generation = useResourceGeneration('store')
  return useSWR(
    ['store-listings', query.shelf ?? '', query.q ?? '', generation],
    () => client.listings(query),
    { keepPreviousData: true },
  )
}

export function useStoreSources(client: StoreClient) {
  const generation = useResourceGeneration('store')
  return useSWR(['store-sources', generation], () => client.sources(), { keepPreviousData: true })
}

export function useListingDetail(client: StoreClient, ref: ListingRef) {
  return useSWR(['store-detail', ref.kind, ref.id], () => client.detail(ref))
}

/** The plan, read only once Permissions is shown: it may fetch the package. */
export function useInstallPlan(client: StoreClient, ref: ListingRef, scope: Scope, shown: boolean) {
  return useSWR(shown ? ['store-plan', ref.kind, ref.id, scope] : null, () =>
    client.plan(ref, scope),
  )
}
