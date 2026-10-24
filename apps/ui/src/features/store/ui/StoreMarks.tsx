import { BadgeCheck, X } from 'lucide-react'
import type { Listing } from '@localixai/store'
import { MiniAppIcon } from '@/shared/ui/MiniAppIcon'

const TAG =
  'inline-flex h-(--chrome-control-xs) items-center gap-1 rounded-full bg-field-fill px-2 text-2xs text-text-soft focus-ring'

/** A tag on a listing: choosing it shows the listings that carry it. */
export function TagButton({ tag, onTag }: { tag: string; onTag: (tag: string) => void }) {
  return (
    <button
      type="button"
      data-tag={tag}
      aria-label={`Show packages tagged ${tag}`}
      className={`${TAG} hover:bg-surface-hover hover:text-foreground`}
      onClick={() => onTag(tag)}
    >
      {tag}
    </button>
  )
}

/** The tag a shelf is filtered by; choosing it removes the filter. */
export function TagFilterChip({ tag, onClear }: { tag: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove the tag filter ${tag}`}
      className={`${TAG} shrink-0 text-foreground hover:bg-surface-hover`}
      onClick={onClear}
    >
      {tag}
      <X className="size-3" aria-hidden />
    </button>
  )
}

/** Verified mark, or who publishes it when Localix does not vouch for them. */
export function PublisherMark({ listing }: { listing: Listing }) {
  return listing.publisher.verified ? (
    <BadgeCheck
      className="size-3.5 shrink-0 text-text-faint"
      role="img"
      aria-label="Verified publisher"
    />
  ) : (
    <span className="shrink-0 text-2xs font-normal text-status-warning">
      Unverified · {listing.publisher.name}
    </span>
  )
}

/** The listing's own icon as its provider serves it, or a monogram tile. Decorative. */
export function ListingTile({ listing, size }: { listing: Listing; size: number }) {
  return (
    <MiniAppIcon
      name={listing.ref.id}
      label={listing.displayName}
      icon={listing.icon}
      size={size}
    />
  )
}
