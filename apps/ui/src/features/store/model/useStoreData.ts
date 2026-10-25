import { useEffect, useMemo } from 'react'
import useSWR, { preload } from 'swr'
import useSWRInfinite from 'swr/infinite'
import type { ListingRef, ListingsResponse, PackageKind, Scope } from '@localixai/store'
import type { StoreClient, StorePageQuery } from '@/shared/api/store-client'
import {
  resourceGeneration,
  subscribeResourceGeneration,
  useResourceGeneration,
} from '@/shared/api/resourceGeneration'

/**
 * The Store's reads. Each key carries the `store` poke's generation, or revalidates on it, so a
 * poke — a job moved, an install or a source changed — reads again; nothing here patches what
 * the server said (P11).
 */

/** Counts for the sections and the sources that could not be read: one listing's worth. */
export function useStoreFacets(client: StoreClient, projectId: string | null) {
  const generation = useResourceGeneration('store')
  return useSWR(
    ['store-facets', projectId, generation],
    () => client.page({ limit: 1, ...(projectId ? { projectId } : {}) }),
    { keepPreviousData: true },
  )
}

export function useDiscover(client: StoreClient, projectId: string | null) {
  const generation = useResourceGeneration('store')
  return useSWR(
    ['store-discover', projectId, generation],
    () => client.discover(projectId ? { projectId } : {}),
    { keepPreviousData: true },
  )
}

export function useStoreSources(client: StoreClient) {
  const generation = useResourceGeneration('store-sources')
  return useSWR(['store-sources', generation], () => client.sources(), { keepPreviousData: true })
}

const detailKey = (ref: ListingRef, projectId: string | null) =>
  ['store-detail', ref.kind, ref.id, projectId, resourceGeneration('store')] as const

export function useListingDetail(client: StoreClient, ref: ListingRef, projectId: string | null) {
  useResourceGeneration('store')
  return useSWR(detailKey(ref, projectId), () => client.detail(ref, projectId ?? undefined), {
    keepPreviousData: true,
  })
}

/** The kinds whose provider can make a new item, and the form of one. */
export function useCreatable(client: StoreClient) {
  return useSWR('store-creatable', () => client.creatable(), { revalidateOnFocus: false })
}

export function useCreateForm(client: StoreClient, kind: PackageKind) {
  return useSWR(['store-create-form', kind], () => client.createFields(kind), {
    revalidateOnFocus: false,
  })
}

/** One install's settings; a poke reads them again, so a change made elsewhere shows. */
export function useListingConfig(
  client: StoreClient,
  ref: ListingRef,
  scope: Scope,
  projectId: string | null,
) {
  const generation = useResourceGeneration('store')
  return useSWR(
    ['store-config', ref.kind, ref.id, scope, projectId, generation],
    () => client.config(ref, scope, projectId ?? undefined),
    { keepPreviousData: true, shouldRetryOnError: false },
  )
}

/**
 * Start reading a listing's page before it is opened — the pointer rests on its card. The read
 * lands in the cache the page reads, so the page opens on it; a second ask is the same request.
 */
export function prefetchDetail(client: StoreClient, ref: ListingRef, projectId: string | null) {
  void preload(detailKey(ref, projectId), () => client.detail(ref, projectId ?? undefined)).catch(
    () => {},
  )
}

/** The plan, read only when it is shown: it may fetch the package. */
export function useInstallPlan(
  client: StoreClient,
  ref: ListingRef,
  scope: Scope,
  projectId: string | null,
  shown: boolean,
) {
  return useSWR(shown ? ['store-plan', ref.kind, ref.id, scope, projectId] : null, () =>
    client.plan(ref, scope, projectId ?? undefined),
  )
}

/**
 * A shelf, a search or a filtered list, a page at a time on the server's keyset cursor: the
 * first page shows at once and the next is read as the list nears its end. A poke reads the
 * loaded pages again in place.
 */
export function usePagedListings(client: StoreClient, query: StorePageQuery | null) {
  const id = query ? JSON.stringify(query) : null
  const pages = useSWRInfinite<ListingsResponse>(
    (index, previous: ListingsResponse | null) => {
      if (!id || (previous && !previous.nextCursor)) return null
      return ['store-page', id, index === 0 ? '' : previous!.nextCursor]
    },
    ([, , cursor]: [string, string, string]) =>
      client.page({ ...query!, ...(cursor ? { cursor } : {}) }),
    { keepPreviousData: true, revalidateFirstPage: false, revalidateOnFocus: false },
  )
  const { mutate } = pages
  useEffect(() => subscribeResourceGeneration('store', () => void mutate()), [mutate])
  const data = pages.data
  const listings = useMemo(() => (data ?? []).flatMap((page) => page.listings), [data])
  const last = data?.at(-1)
  const loadingMore = pages.isLoading || (pages.size > 0 && data?.[pages.size - 1] === undefined)
  return {
    listings,
    first: data?.[0],
    loading: !data && !pages.error,
    error: pages.error as unknown,
    hasMore: Boolean(last?.nextCursor),
    loadingMore,
    loadMore: () => {
      if (last?.nextCursor && !loadingMore) void pages.setSize((size) => size + 1)
    },
  }
}
