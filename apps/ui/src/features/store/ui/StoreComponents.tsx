import { memo, useMemo, useState } from 'react'
import {
  componentCount,
  type BrowsableComponentKind,
  type Listing,
  type StoreComponent,
} from '@localixai/store'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { ItemCard } from '@localixai/kit/item-card'
import { SearchInput } from '@localixai/kit/search-input'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { WorkbenchFilterBar } from '@localixai/kit/workbench-filter-bar'
import { listColumns, useStoreFrame } from '../model/layout'
import { COMPONENT_LABELS, KIND_LABELS } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { useDebounced } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { SEARCH_DEBOUNCE_MS } from '../model/searchDebounce'
import { usePagedListings } from '../model/useStoreData'
import { GetAction } from './GetAction'
import { ListSkeleton, PagedList } from './PagedList'
import { ListingIcon } from './StoreMarks'

interface Row {
  listing: Listing
  component: StoreComponent
}

/**
 * The components of `kind` the listings contain, by name. A standalone package of that kind (a
 * skill of the person's) is one row of its own. A provider that counts components but does not
 * name them yet gives one row for the lot ("3 commands"), so they are not lost.
 */
function rowsOf(listings: readonly Listing[], kind: BrowsableComponentKind): Row[] {
  return listings.flatMap((listing) => {
    if (listing.ref.kind === kind)
      return [
        { listing, component: { kind, name: listing.displayName, description: listing.summary } },
      ]
    const named = (listing.components ?? []).filter((part) => part.kind === kind)
    if (named.length > 0) return named.map((component) => ({ listing, component }))
    const count = componentCount(listing, kind)
    const { one, many } = COMPONENT_LABELS[kind]
    return count > 0
      ? [{ listing, component: { kind, name: count === 1 ? one : `${count} ${many}` } }]
      : []
  })
}

const ComponentRow = memo(function ComponentRow({ listing, component }: Row) {
  const store = useStoreScope()
  // A standalone item says whose it is; one inside a package says which package.
  const alone = listing.ref.kind === component.kind
  const from = alone
    ? listing.source.label
    : `In ${listing.displayName} · ${KIND_LABELS[listing.ref.kind].one}`
  return (
    <ItemCard
      data-component={`${component.kind}:${component.name}`}
      data-from={listing.ref.id}
      tile={<ListingIcon listing={listing} size={36} />}
      title={component.name}
      openLabel={component.name}
      description={component.description ?? from}
      footer={
        component.description ? (
          <span className="pointer-events-none truncate text-2xs text-text-faint">{from}</span>
        ) : undefined
      }
      actions={<GetAction listing={listing} />}
      onOpen={() => (alone ? store.open(listing) : store.open(listing, component))}
      onPointerEnter={() => store.prefetch(listing.ref)}
    />
  )
})

/**
 * A capability shelf: the components themselves, not the packages — each command, skill or mod
 * with what it does and where it is from, page by page: its own source, or the package it is in.
 * A row inside a package opens that package on What's inside with the component marked; its Get
 * button gets the whole package. The filter searches the Store for them.
 */
export function StoreComponents({ kind }: { kind: BrowsableComponentKind }) {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const [filter, setFilter] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const many = COMPONENT_LABELS[kind].many
  const asked = useDebounced(filter.trim(), SEARCH_DEBOUNCE_MS)
  const page = usePagedListings(store.client, {
    shelf: `capability:${kind}`,
    ...(asked ? { q: asked } : {}),
    ...(installedOnly ? { installed: true } : {}),
    ...(store.project ? { projectId: store.project.id } : {}),
  })
  const rows = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return rowsOf(page.listings, kind).filter(({ listing, component }) => {
      const text = `${component.name} ${component.description ?? ''} ${listing.displayName}`
      return words.every((word) => text.toLowerCase().includes(word))
    })
  }, [page.listings, kind, filter])
  const columns = listColumns(layout, width)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <WorkbenchFilterBar aria-label="Filters" className="border-b-0 px-0 py-0">
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder={`Filter ${many}`}
          aria-label={`Filter ${many}`}
          size="md"
        />
        <TogglePill active={installedOnly} onClick={() => setInstalledOnly((on) => !on)}>
          Installed only
        </TogglePill>
      </WorkbenchFilterBar>
      {page.loading ? (
        <ListSkeleton columns={columns} />
      ) : rows.length === 0 ? (
        <EmptyHint>Nothing matches.</EmptyHint>
      ) : (
        <PagedList
          label={many}
          items={rows}
          columns={columns}
          keyOf={({ listing, component }) => `${keyOf(listing.ref)}:${component.name}`}
          render={(row) => <ComponentRow {...row} />}
          hasMore={page.hasMore}
          loadMore={page.loadMore}
          loadingMore={page.loadingMore}
        />
      )}
    </div>
  )
}
