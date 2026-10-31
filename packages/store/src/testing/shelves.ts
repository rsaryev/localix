import type { ComponentKind, Listing } from '../contract'
import { SHELVES, componentCount, hasUpdate, type ShelfId } from '../shelves'

// The shelf rule in memory, for the store's fakes. The API answers the same question in SQL
// (`apps/api/src/features/store/index-repository-filters.ts`); the shelves tests pin this copy.

/** Whether `listing` is on `shelf`. */
export function onShelf(listing: Listing, shelf: ShelfId): boolean {
  if (shelf === 'discover') return listing.featured || listing.recommended
  // What came from a source: not what a person wrote, and not what comes bundled with something.
  if (shelf === 'installed')
    return listing.installs.length > 0 && !listing.authored && !listing.bundled
  if (shelf === 'updates') return hasUpdate(listing)
  if (shelf === 'yours' || shelf === 'project')
    return listing.authored === (shelf === 'yours' ? 'user' : 'project')
  const [group, kind] = shelf.split(':') as ['package' | 'capability', string]
  return group === 'package' ? listing.ref.kind === kind : capabilityCount(listing, kind) > 0
}

/**
 * How many rows `listing` makes on the capability shelf of `kind`: a standalone package of that
 * kind is one row, any other lists the components it contains.
 */
const capabilityCount = (listing: Listing, kind: string): number =>
  listing.ref.kind === kind ? 1 : componentCount(listing, kind as ComponentKind)

/**
 * How many rows each shelf shows; a shelf with none is left out. A capability shelf lists
 * components, so it counts them: a package with three commands is three on Commands, and a
 * standalone skill is one on Skills.
 */
export function shelfCounts(listings: readonly Listing[]): Partial<Record<ShelfId, number>> {
  const counts: Partial<Record<ShelfId, number>> = {}
  for (const shelf of SHELVES) {
    const kind = shelf.startsWith('capability:') ? shelf.slice(11) : null
    const count = listings.reduce(
      (sum, listing) =>
        sum + (kind ? capabilityCount(listing, kind) : onShelf(listing, shelf) ? 1 : 0),
      0,
    )
    if (count > 0) counts[shelf] = count
  }
  return counts
}
