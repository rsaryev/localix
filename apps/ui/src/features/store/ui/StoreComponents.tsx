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
import { listColumns, useStoreFrame } from '../model/layout'
import { COMPONENT_LABELS, KIND_LABELS } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { useDebounced } from '../model/useDebounced'
import { usePagedListings } from '../model/useStoreData'
import { GetAction } from './GetAction'
import { ListSkeleton, PagedList } from './PagedList'
import { ListingIcon } from './StoreMarks'

interface Row {
  listing: Listing
  component: StoreComponent
}

/**
 * The components of `kind` the listings contain, by name. A provider that counts them but does
 * not name them yet gives one row for the lot ("3 commands"), so they are not lost.
 */
function rowsOf(listings: readonly Listing[], kind: BrowsableComponentKind): Row[] {
  return listings.flatMap((listing) => {
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
  const from = `${listing.displayName} · ${KIND_LABELS[listing.ref.kind].one}`
  return (
    <ItemCard
      data-component={`${component.kind}:${component.name}`}
      data-from={listing.ref.id}
      tile={<ListingIcon listing={listing} size={36} />}
      title={component.name}
      openLabel={component.name}
      description={component.description ?? `From ${from}`}
      footer={
        component.description ? (
          <span className="pointer-events-none truncate text-2xs text-text-faint">From {from}</span>
        ) : undefined
      }
      actions={<GetAction listing={listing} />}
      onOpen={() => store.open(listing, component)}
      onPointerEnter={() => store.prefetch(listing.ref)}
    />
  )
})

/**
 * A capability shelf: the components themselves, not the packages — each command, skill or mod
 * with what it does and the package it comes from, page by page. A row opens that package on
 * What's inside with the component marked; its Get button gets the whole package. The filter
 * searches the Store for them.
 */
export function StoreComponents({ kind }: { kind: BrowsableComponentKind }) {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const [filter, setFilter] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const many = COMPONENT_LABELS[kind].many
  const asked = useDebounced(filter.trim())
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
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder={`Filter ${many}`}
          aria-label={`Filter ${many}`}
          size="md"
          className="w-64 max-w-full"
        />
        <TogglePill active={installedOnly} onClick={() => setInstalledOnly((on) => !on)}>
          Installed only
        </TogglePill>
      </div>
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
