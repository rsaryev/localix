import { memo } from 'react'
import type { Listing } from '@localixai/store'
import { ItemCard } from '@localixai/kit/item-card'
import { TileCard } from '@localixai/kit/tile-card'
import { KIND_LABELS } from '../model/presentation'
import { keyOf } from '../model/useExtrasAfterInstall'
import { useStoreScope } from '../model/storeContext'
import { GetAction } from './GetAction'
import { ListingIcon, TrustMark, VerifiedMark } from './StoreMarks'

/**
 * A listing in a Discover row: the compact lockup — icon, name, one quiet line of who publishes it
 * and what it is (the name gives way before the kind does), and its Get button at the right. Resting on it starts reading its page, so the page opens at once.
 */
export const ListingTileCard = memo(function ListingTileCard({ listing }: { listing: Listing }) {
  const store = useStoreScope()
  return (
    <div data-listing={listing.ref.id} data-kind={listing.ref.kind} className="h-full">
      <TileCard
        tile={<ListingIcon listing={listing} size={56} />}
        title={listing.displayName}
        subtitle={
          <span data-slot="tile-meta" className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate">{listing.publisher.name}</span>
            <VerifiedMark listing={listing} className="size-3" />
            <span className="shrink-0">{` · ${KIND_LABELS[listing.ref.kind].one}`}</span>
          </span>
        }
        action={<GetAction listing={listing} />}
        openLabel={listing.displayName}
        onOpen={() => store.open(listing)}
        onIntent={() => store.prefetch(listing.ref)}
      />
    </div>
  )
})

/**
 * A listing in a list — See all, search results, a category: its icon, name and trust, one line
 * of what it does, who publishes it and its kind, and its Get button.
 */
export const ListingRow = memo(function ListingRow({
  listing,
  showKind = true,
}: {
  listing: Listing
  /** Off its own kind's shelf, where the kind goes without saying. */
  showKind?: boolean
}) {
  const store = useStoreScope()
  const problem =
    listing.job?.phase === 'failed'
      ? listing.job.error
      : store.extraProblems[keyOf(listing.ref)]
        ? `Installed, but ${store.extraProblems[keyOf(listing.ref)]}`
        : undefined
  return (
    <ItemCard
      data-listing={listing.ref.id}
      data-kind={listing.ref.kind}
      tile={<ListingIcon listing={listing} size={44} />}
      title={listing.displayName}
      marks={<TrustMark listing={listing} />}
      openLabel={listing.displayName}
      description={listing.summary}
      note={problem}
      footer={
        <span className="pointer-events-none truncate text-2xs text-text-faint">
          {listing.publisher.name}
          {showKind && ` · ${KIND_LABELS[listing.ref.kind].one}`}
          {listing.category && ` · ${listing.category}`}
        </span>
      }
      actions={<GetAction listing={listing} />}
      onOpen={() => store.open(listing)}
      onPointerEnter={() => store.prefetch(listing.ref)}
      onFocus={() => store.prefetch(listing.ref)}
    />
  )
})
