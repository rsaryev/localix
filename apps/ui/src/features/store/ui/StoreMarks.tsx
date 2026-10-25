import { BadgeCheck } from 'lucide-react'
import type { Listing } from '@localixai/store'
import { AppTile } from '@localixai/kit/app-tile'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { storeMediaSrc } from '@/shared/ui/MiniAppIcon'
import { TRUST_LABELS, isVerified, trustOf } from '../model/presentation'

/** The listing's own icon as its provider serves it, or its monogram tile. Decorative. */
export function ListingIcon({ listing, size }: { listing: Listing; size: number }) {
  return (
    <AppTile
      identity={`${listing.ref.kind}/${listing.ref.id}`}
      label={listing.displayName}
      src={listing.icon ? storeMediaSrc(listing.icon) : undefined}
      size={size}
    />
  )
}

/** The mark of a listing from Localix or an official source; nothing for any other. */
export function VerifiedMark({ listing, className }: { listing: Listing; className?: string }) {
  const trust = trustOf(listing)
  if (!trust || !isVerified(listing)) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <BadgeCheck
          role="img"
          aria-label={`Verified · ${TRUST_LABELS[trust]}`}
          className={cn('size-3.5 shrink-0 text-text-soft', className)}
        />
      </TooltipTrigger>
      <TooltipContent>Verified · {TRUST_LABELS[trust]}</TooltipContent>
    </Tooltip>
  )
}

/**
 * How far its source is trusted: a verified mark for Localix's own and the official sources, a
 * quiet "Community" for a community one — said, never alarming. What has no source (the person's
 * own, built in) says nothing: the provider leaves `trust` out.
 */
export function TrustMark({ listing, className }: { listing: Listing; className?: string }) {
  if (trustOf(listing) === 'community')
    return (
      <span className={cn('shrink-0 text-2xs font-normal text-text-faint', className)}>
        Community
      </span>
    )
  return <VerifiedMark listing={listing} className={className} />
}

/** Who publishes it, and how far its source is trusted. */
export function Publisher({ listing, className }: { listing: Listing; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      <span className="truncate">{listing.publisher.name}</span>
      <TrustMark listing={listing} />
    </span>
  )
}
