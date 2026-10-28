import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ListingRef, StoreCategory } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { SectionHeading } from '@localixai/kit/section-heading'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { TabBar } from '@localixai/kit/tabs'
import type { StorePageQuery } from '@/shared/api/store-client'
import { listColumns, useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { useRemembered } from '../model/storeMemory'
import { keyOf } from '../model/useExtrasAfterInstall'
import { useDiscover, usePagedListings, useStoreSources } from '../model/useStoreData'
import { FilterMenu } from './FilterMenu'
import { ListingRow } from './ListingCards'
import { ListSkeleton, PagedList } from './PagedList'
import { StoreProblems } from './StoreProblems'
import { StoreReadFailure } from './StoreReadFailure'

const ALL = 'all'
/** Category tabs shown before the rest go under "More": by the pane's width. */
const TABS = { wide: 6, medium: 4, narrow: 0 } as const

/** A list of exactly these listings — a collection, a computed row — from Discover's answer. */
function ChosenListings({ refs }: { refs: readonly ListingRef[] }) {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const discover = useDiscover(store.client, store.project?.id ?? null)
  const listings = useMemo(() => {
    const byKey = new Map((discover.data?.listings ?? []).map((l) => [keyOf(l.ref), l]))
    return refs.flatMap((ref) => byKey.get(keyOf(ref)) ?? [])
  }, [discover.data, refs])
  if (!discover.data)
    return discover.error ? (
      <StoreReadFailure
        what="The list"
        error={discover.error}
        onRetry={() => void discover.mutate()}
      />
    ) : (
      <ListSkeleton columns={listColumns(layout, width)} />
    )
  return (
    <PagedList
      label="Packages"
      items={listings}
      columns={listColumns(layout, width)}
      keyOf={(listing) => keyOf(listing.ref)}
      render={(listing) => <ListingRow listing={listing} />}
      hasMore={false}
      loadMore={() => {}}
      loadingMore={false}
    />
  )
}

/**
 * A shelf or a filtered list, page by page: category tabs (the busiest few, the rest under More,
 * never behind the source filter), a source filter, and the listings in rows, one to three
 * columns by the pane's width.
 */
function QueriedListings({ query, showKind }: { query: StorePageQuery; showKind: boolean }) {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const memory = JSON.stringify(query)
  const [category, setCategory] = useRemembered<string | null>(`${memory}:category`, null)
  const [source, setSource] = useRemembered<string | null>(`${memory}:source`, query.source ?? null)
  const sources = useStoreSources(store.client)
  const page = usePagedListings(store.client, {
    ...query,
    ...(category ? { category: category as StoreCategory } : {}),
    ...(source ? { source } : {}),
    ...(store.project ? { projectId: store.project.id } : {}),
  })
  const facets = page.first?.facets
  const [counts, setCounts] = useState<Record<string, number>>({})
  // The tabs keep the counts of the unfiltered list, so choosing one does not empty the row.
  if (!category && facets && facets.category !== counts) setCounts(facets.category)
  const categories = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
  const tabs = categories.slice(0, TABS[layout])
  const more = categories.slice(TABS[layout])
  const chosenInMore = more.some(([id]) => id === category)
  const columns = listColumns(layout, width)
  const sourceOptions = (sources.data?.sources ?? [])
    .filter((s) => !query.shelf?.startsWith('package:') || s.kind === query.shelf.slice(8))
    .map((s) => ({ value: s.id, label: s.label, count: facets?.source[s.id] }))

  const menus = (
    <div className="flex items-center gap-1.5">
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={chosenInMore ? 'secondary' : 'ghost'}>
              {chosenInMore ? category : tabs.length ? 'More' : 'Category'}
              <ChevronDown data-icon="inline-end" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <MenuEntries
              family="dropdown"
              entries={more.map(([id, count]) => ({
                id,
                label: id,
                hint: count.toLocaleString('en-US'),
                selected: id === category,
                onSelect: () => setCategory(id),
              }))}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {sourceOptions.length > 1 && (
        <FilterMenu label="Source" options={sourceOptions} value={source} onChange={setSource} />
      )}
    </div>
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {categories.length > 1 ? (
        <TabBar
          aria-label="Categories"
          items={[
            { id: ALL, label: 'All' },
            ...tabs.map(([id, count]) => ({ id, label: id, badge: count })),
          ]}
          active={category && !chosenInMore ? category : ALL}
          onChange={(id) => setCategory(id === ALL ? null : id)}
          trailing={<div className="pl-2">{menus}</div>}
        />
      ) : (
        sourceOptions.length > 1 && menus
      )}
      <StoreProblems problems={page.first?.problems ?? []} />
      {page.loading ? (
        <ListSkeleton columns={columns} />
      ) : page.error && !page.first ? (
        <StoreReadFailure what="The list" error={page.error} onRetry={page.retry} />
      ) : page.listings.length === 0 ? (
        <EmptyHint>Nothing here matches.</EmptyHint>
      ) : (
        <PagedList
          label="Packages"
          items={page.listings}
          columns={columns}
          keyOf={(listing) => keyOf(listing.ref)}
          render={(listing) => <ListingRow listing={listing} showKind={showKind} />}
          hasMore={page.hasMore}
          loadMore={page.loadMore}
          loadingMore={page.loadingMore}
        />
      )}
    </div>
  )
}

/** A full list over a section: a shelf, a row's "See all", a category, a collection, a source. */
export function ListingsView({
  title,
  subtitle,
  query,
  refs,
  actions,
}: {
  title: string
  subtitle?: string
  query?: StorePageQuery
  refs?: readonly ListingRef[]
  /** What can be done to the shelf (Add, Archive unused), on the heading's row. */
  actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SectionHeading title={title} description={subtitle} actions={actions} />
      {refs ? (
        <ChosenListings refs={refs} />
      ) : (
        <QueriedListings query={query ?? {}} showKind={!query?.shelf?.startsWith('package:')} />
      )}
    </div>
  )
}
