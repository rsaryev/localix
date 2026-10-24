import { useId, useState } from 'react'
import {
  componentCount,
  type BrowsableComponentKind,
  type Listing,
  type StoreComponent,
} from '@localixai/store'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { ItemCard } from '@localixai/kit/item-card'
import { SearchInput } from '@localixai/kit/search-input'
import { Switch } from '@localixai/kit/switch'
import { keyOf } from '../model/filters'
import { COMPONENT_LABELS, KIND_LABELS } from '../model/presentation'
import { InstallAction, type ListingActions } from './InstallAction'
import { ListingTile } from './StoreMarks'

interface Row {
  listing: Listing
  component: StoreComponent
}

/**
 * The components of `kind` the listings contain, by name. A provider that counts them but does
 * not name them yet gives one row for the lot ("3 commands"), so they are not lost.
 */
function rowsOf(listings: readonly Listing[], kind: BrowsableComponentKind): Row[] {
  return listings
    .flatMap((listing) => {
      const named = (listing.components ?? []).filter((part) => part.kind === kind)
      if (named.length > 0) return named.map((component) => ({ listing, component }))
      const count = componentCount(listing, kind)
      const { one, many } = COMPONENT_LABELS[kind]
      return count > 0
        ? [{ listing, component: { kind, name: count === 1 ? one : `${count} ${many}` } }]
        : []
    })
    .sort((a, b) => a.component.name.localeCompare(b.component.name))
}

const matches = ({ listing, component }: Row, words: string[]) => {
  const text = [component.name, component.description, listing.displayName].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * A capability shelf: the components themselves, not the packages — each command, skill or mod
 * with what it does and the package it comes from. A row opens that package on What's inside
 * with the component marked; installing from a row installs the whole package, and says so.
 */
export function StoreComponents({
  kind,
  listings,
  onOpen,
  ...actions
}: {
  kind: BrowsableComponentKind
  listings: readonly Listing[]
  onOpen: (listing: Listing, component: StoreComponent) => void
} & ListingActions) {
  const [filter, setFilter] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const switchId = useId()
  const many = COMPONENT_LABELS[kind].many
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const rows = rowsOf(listings, kind).filter(
    (row) => (!installedOnly || row.listing.installs.length > 0) && matches(row, words),
  )
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 px-2">
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder={`Filter ${many}`}
          aria-label={`Filter ${many}`}
          size="md"
          className="w-64 max-w-full"
        />
        <div className="flex items-center gap-2 text-xs text-text-soft">
          <Switch
            id={switchId}
            size="sm"
            checked={installedOnly}
            onChange={(event) => setInstalledOnly(event.target.checked)}
          />
          <label htmlFor={switchId}>Installed only</label>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyHint>Nothing matches.</EmptyHint>
      ) : (
        <ul className="flex flex-col">
          {rows.map(({ listing, component }) => {
            const from = `from ${listing.displayName} · ${KIND_LABELS[listing.ref.kind].one}`
            return (
              <ItemCard
                key={`${keyOf(listing)}:${component.name}`}
                data-component={`${component.kind}:${component.name}`}
                data-from={listing.ref.id}
                tile={<ListingTile listing={listing} size={32} />}
                title={component.name}
                openLabel={component.name}
                description={component.description ?? from}
                footer={
                  component.description ? (
                    <span className="pointer-events-none truncate text-2xs text-text-faint">
                      {from}
                    </span>
                  ) : undefined
                }
                actions={<InstallAction listing={listing} whole {...actions} />}
                onOpen={() => onOpen(listing, component)}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
