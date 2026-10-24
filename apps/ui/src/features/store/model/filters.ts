import { hasUpdate, isActiveJob, type Listing } from '@localixai/store'

/** What narrows a shelf beyond the server's answer: a category tab, one tag and one source. */
export interface ShelfFilter {
  /** A category id, or {@link ALL}. */
  category: string
  tag: string | null
  /** A source's id, or null for every source. */
  source: string | null
}

export const ALL = 'all'
export const NO_FILTER: ShelfFilter = { category: ALL, tag: null, source: null }

export function filterListings(listings: readonly Listing[], filter: ShelfFilter): Listing[] {
  return listings.filter(
    (listing) =>
      (filter.category === ALL || listing.category === filter.category) &&
      (!filter.tag || listing.tags.includes(filter.tag)) &&
      (!filter.source || listing.source.id === filter.source),
  )
}

export const isBusy = (listing: Listing) => isActiveJob(listing.job)

/** Which group a listing is in: one that wants an update, one already here, or one to add. */
export function groupOf(listing: Listing): 'updates' | 'installed' | 'available' {
  if (hasUpdate(listing)) return 'updates'
  if (listing.installs.length > 0 && !isBusy(listing)) return 'installed'
  return 'available'
}

/** The categories the listings declare, sorted. */
export const categoriesOf = (listings: readonly Listing[]) =>
  [...new Set(listings.flatMap((listing) => (listing.category ? [listing.category] : [])))].sort()

/** A listing's key, for maps and data attributes. */
export const keyOf = (listing: Pick<Listing, 'ref'>) => `${listing.ref.kind}/${listing.ref.id}`
