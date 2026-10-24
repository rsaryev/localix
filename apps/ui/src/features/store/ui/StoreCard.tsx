import { hasUpdate, type Listing } from '@localixai/store'
import { ItemCard } from '@localixai/kit/item-card'
import { distinctInside, KIND_LABELS } from '../model/presentation'
import { InstallAction, type ExtraChoice, type ListingActions } from './InstallAction'
import { ListingTile, PublisherMark, TagButton } from './StoreMarks'

const CARD_TAGS = 3

export interface StoreCardProps extends ListingActions {
  listing: Listing
  /** Every listing in the Store, to say only what tells this one apart. */
  peers: readonly Listing[]
  onOpen: (listing: Listing) => void
  onTag: (tag: string) => void
  /** The install extras it can have here: an icon each beside Install. */
  extras?: readonly ExtraChoice[]
  /** Why an extra chosen with the install was not made. */
  extraProblem?: string
  /** Say what kind it is: not on its own kind's shelf, where that goes without saying. */
  showKind?: boolean
}

/**
 * One listing on a shelf, the same for every kind and laid out as the mini app rows always were:
 * its icon; its name and verified mark; one line of what it does; up to three tags, followed by
 * its kind and what is inside only where that tells it apart; and the actions its state allows.
 * The whole card opens its page; the tags and the actions are their own controls.
 */
export function StoreCard({
  listing,
  peers,
  onOpen,
  onTag,
  extras,
  extraProblem,
  showKind = true,
  ...actions
}: StoreCardProps) {
  const failed = listing.job?.phase === 'failed' ? listing.job.error : undefined
  const note = failed ?? (extraProblem ? `Installed, but ${extraProblem}` : undefined)
  const installed = listing.installs[0]
  const about = [showKind ? KIND_LABELS[listing.ref.kind].one : '', distinctInside(listing, peers)]
    .filter(Boolean)
    .join(' · ')
  const tags = listing.tags.slice(0, CARD_TAGS)
  return (
    <ItemCard
      data-listing={listing.ref.id}
      data-kind={listing.ref.kind}
      tile={<ListingTile listing={listing} size={40} />}
      title={listing.displayName}
      openLabel={listing.displayName}
      marks={
        <>
          <PublisherMark listing={listing} />
          {hasUpdate(listing) && installed?.version && (
            <span className="shrink-0 text-2xs font-normal text-text-faint tabular-nums">
              {installed.version} → {installed.updateTo}
            </span>
          )}
        </>
      }
      description={listing.summary}
      note={note}
      footer={
        tags.length > 0 || about ? (
          <>
            {tags.map((tag) => (
              <TagButton key={tag} tag={tag} onTag={onTag} />
            ))}
            {about && (
              <span className="pointer-events-none truncate px-1 text-2xs text-text-faint">
                {about}
              </span>
            )}
          </>
        ) : undefined
      }
      actions={<InstallAction listing={listing} extras={extras} {...actions} />}
      onOpen={() => onOpen(listing)}
    />
  )
}
