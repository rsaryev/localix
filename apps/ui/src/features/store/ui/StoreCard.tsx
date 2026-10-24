import { hasUpdate, type Listing } from '@localixai/store'
import { ItemCard } from '@localixai/kit/item-card'
import { insideLine, KIND_LABELS } from '../model/presentation'
import { InstallAction, type ListingActions } from './InstallAction'
import { ListingTile, PublisherMark, TagButton } from './StoreMarks'

const CARD_TAGS = 3

export interface StoreCardProps extends ListingActions {
  listing: Listing
  onOpen: (listing: Listing) => void
  onTag: (tag: string) => void
  onInstallAsApp?: (consent: boolean) => void
  /** Why the app of its own chosen with the install was not made. */
  appProblem?: string
  /** Say what kind it is: not on its own kind's shelf, where that goes without saying. */
  showKind?: boolean
}

/**
 * One listing on a shelf, the same for every kind: its icon, name, publisher, what it does, what
 * kind it is and what is inside, up to three tags, and the one action its state allows. The whole
 * card opens its page; the tags and the action are their own controls.
 */
export function StoreCard({
  listing,
  onOpen,
  onTag,
  onInstallAsApp,
  appProblem,
  showKind = true,
  ...actions
}: StoreCardProps) {
  const failed = listing.job?.phase === 'failed' ? listing.job.error : undefined
  const note =
    failed ??
    (appProblem ? `Installed, but the desktop app was not made: ${appProblem}` : undefined)
  const installed = listing.installs[0]
  const inside = [showKind ? KIND_LABELS[listing.ref.kind].one : '', insideLine(listing)]
    .filter(Boolean)
    .join(' · ')
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
          <span className="min-w-0 truncate text-2xs font-normal text-text-faint" title={inside}>
            {inside}
          </span>
        </>
      }
      description={listing.summary}
      note={note}
      footer={
        listing.tags.length > 0 ? (
          <>
            {listing.tags.slice(0, CARD_TAGS).map((tag) => (
              <TagButton key={tag} tag={tag} onTag={onTag} />
            ))}
          </>
        ) : undefined
      }
      actions={<InstallAction listing={listing} onInstallAsApp={onInstallAsApp} {...actions} />}
      onOpen={() => onOpen(listing)}
    />
  )
}
