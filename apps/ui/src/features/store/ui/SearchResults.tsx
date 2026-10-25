import { useMemo, useState } from 'react'
import {
  PACKAGE_KINDS,
  STORE_CATEGORIES,
  TRUSTS,
  type Listing,
  type StoreCategory,
  type StoreComponent,
  type Trust,
} from '@localixai/store'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { ItemCard } from '@localixai/kit/item-card'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { listColumns, useStoreFrame } from '../model/layout'
import {
  CATEGORY_ICONS,
  COMPONENT_LABELS,
  KIND_LABELS,
  TRUST_LABELS,
  plural,
} from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { useDiscover, usePagedListings, useStoreSources } from '../model/useStoreData'
import { FilterMenu } from './FilterMenu'
import { GetAction } from './GetAction'
import { ListingRow } from './ListingCards'
import { ListSkeleton, PagedList } from './PagedList'
import { ListingIcon } from './StoreMarks'

interface Filters {
  kind: string | null
  category: string | null
  source: string | null
  trust: string | null
  installed: boolean
}
const NONE: Filters = { kind: null, category: null, source: null, trust: null, installed: false }

/** The components of the found packages whose name or description says what was searched for. */
function insideOf(listings: readonly Listing[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return listings
    .flatMap((listing) =>
      (listing.components ?? [])
        .filter((part) =>
          words.every((word) =>
            `${part.name} ${part.description ?? ''}`.toLowerCase().includes(word),
          ),
        )
        .map((component) => ({ listing, component })),
    )
    .slice(0, 6)
}

function InsideRow({ listing, component }: { listing: Listing; component: StoreComponent }) {
  const store = useStoreScope()
  return (
    <ItemCard
      tile={<ListingIcon listing={listing} size={36} />}
      title={component.name}
      openLabel={`${component.name}, in ${listing.displayName}`}
      description={component.description ?? COMPONENT_LABELS[component.kind].one}
      footer={
        <span className="pointer-events-none truncate text-2xs text-text-faint">
          {COMPONENT_LABELS[component.kind].one} in {listing.displayName}
        </span>
      }
      actions={<GetAction listing={listing} />}
      onOpen={() => store.open(listing, component)}
    />
  )
}

/**
 * THE STORE'S SEARCH RESULTS (`docs/internals/store-scale.md`, "Search"): the packages found,
 * page by page through the global search service, and what inside them matched; filters for
 * kind, category, source, trust and installed as chips; skeletons while it reads; and, when
 * nothing matches, the categories to browse instead.
 */
export function SearchResults({ query }: { query: string }) {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const [filters, setFilters] = useState<Filters>(NONE)
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))
  const sources = useStoreSources(store.client)
  const discover = useDiscover(store.client, store.project?.id ?? null)
  const page = usePagedListings(store.client, {
    q: query,
    ...(filters.kind ? { shelf: `package:${filters.kind}` } : {}),
    ...(filters.category ? { category: filters.category as StoreCategory } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.trust ? { trust: filters.trust as Trust } : {}),
    ...(filters.installed ? { installed: true } : {}),
    ...(store.project ? { projectId: store.project.id } : {}),
  })
  const facets = page.first?.facets
  const inside = useMemo(() => insideOf(page.listings, query), [page.listings, query])
  const columns = listColumns(layout, width)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-foreground">Results for “{query}”</h2>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
          <FilterMenu
            label="Kind"
            value={filters.kind}
            onChange={(kind) => set({ kind })}
            options={PACKAGE_KINDS.filter((k) => facets?.kind[k]).map((k) => ({
              value: k,
              label: KIND_LABELS[k].many,
              count: facets?.kind[k],
            }))}
          />
          <FilterMenu
            label="Category"
            value={filters.category}
            onChange={(category) => set({ category })}
            options={STORE_CATEGORIES.filter((c) => facets?.category[c]).map((c) => ({
              value: c,
              label: c,
              count: facets?.category[c],
            }))}
          />
          <FilterMenu
            label="Source"
            value={filters.source}
            onChange={(source) => set({ source })}
            options={(sources.data?.sources ?? []).map((s) => ({
              value: s.id,
              label: s.label,
              count: facets?.source[s.id],
            }))}
          />
          <FilterMenu
            label="Trust"
            value={filters.trust}
            onChange={(trust) => set({ trust })}
            options={TRUSTS.map((t) => ({ value: t, label: TRUST_LABELS[t] }))}
          />
          <TogglePill
            active={filters.installed}
            onClick={() => set({ installed: !filters.installed })}
          >
            Installed
          </TogglePill>
          {page.first?.strategy?.mode === 'lexical' && (
            <span className="text-2xs text-text-faint">Matched by words only</span>
          )}
        </div>
      </header>
      {page.loading ? (
        <ListSkeleton columns={columns} />
      ) : page.listings.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <EmptyHint className="h-auto p-0">Nothing matches “{query}”.</EmptyHint>
          {discover.data && discover.data.categories.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              <span className="w-full text-center text-xs text-text-soft">
                Browse a category instead
              </span>
              {discover.data.categories.map((category) => {
                const Icon = CATEGORY_ICONS[category.id as StoreCategory] ?? CATEGORY_ICONS.Other
                return (
                  <TogglePill
                    key={category.id}
                    active={false}
                    onClick={() =>
                      store.show({
                        type: 'list',
                        title: category.label,
                        query: { category: category.id as StoreCategory },
                      })
                    }
                  >
                    <Icon className="size-3" aria-hidden />
                    {category.label}
                  </TogglePill>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {inside.length > 0 && (
            <section aria-label="Inside packages" className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-text-soft">Inside packages</h3>
              <ul
                className="grid gap-x-4"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {inside.map(({ listing, component }) => (
                  <InsideRow
                    key={`${keyOf(listing.ref)}:${component.kind}:${component.name}`}
                    listing={listing}
                    component={component}
                  />
                ))}
              </ul>
            </section>
          )}
          <section aria-label="Packages" className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-text-soft">
              Packages
              {facets && (
                <span className="ml-1.5 font-normal text-text-faint tabular-nums">
                  {plural(page.listings.length, 'result')}
                  {page.hasMore && '+'}
                </span>
              )}
            </h3>
            <PagedList
              label="Packages found"
              items={page.listings}
              columns={columns}
              keyOf={(listing) => keyOf(listing.ref)}
              render={(listing) => <ListingRow listing={listing} />}
              hasMore={page.hasMore}
              loadMore={page.loadMore}
              loadingMore={page.loadingMore}
            />
          </section>
        </>
      )}
    </div>
  )
}
