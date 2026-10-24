import {
  COMPONENT_KINDS,
  PACKAGE_KINDS,
  type ComponentKind,
  type Listing,
  type PackageKind,
  type StoreJob,
} from './contract'

/**
 * A Store section, derived from listings (`docs/internals/store.md`, "Hierarchy"): Discover, one
 * shelf per package kind, one per component kind a listing contains, and the person's library.
 * A shelf no listing is on is hidden, so a new kind needs no screen of its own.
 */
export type ShelfId =
  | 'discover'
  | 'installed'
  | 'updates'
  | `package:${PackageKind}`
  | `capability:${ComponentKind}`

export const packageShelf = (kind: PackageKind): ShelfId => `package:${kind}`
export const capabilityShelf = (kind: ComponentKind): ShelfId => `capability:${kind}`

/** Every shelf, in the order the Store lists them. */
export const SHELVES: readonly ShelfId[] = [
  'discover',
  ...PACKAGE_KINDS.map(packageShelf),
  ...COMPONENT_KINDS.map(capabilityShelf),
  'installed',
  'updates',
]

const KNOWN = new Set<string>(SHELVES)

/** A shelf id from a query or a tab payload, or null when it names no shelf. */
export function parseShelf(raw: unknown): ShelfId | null {
  return typeof raw === 'string' && KNOWN.has(raw) ? (raw as ShelfId) : null
}

/** An install or update in flight. */
export const isActiveJob = (job: StoreJob | undefined): boolean =>
  job !== undefined && ['queued', 'downloading', 'installing'].includes(job.phase)

/** How many of a component a listing contains: 0 when it has none or does not know. */
export const componentCount = (listing: Listing, kind: ComponentKind): number =>
  listing.contents === 'unknown' ? 0 : (listing.contents[kind] ?? 0)

export const hasUpdate = (listing: Listing): boolean =>
  !listing.incompatible && listing.installs.some((install) => install.updateTo !== undefined)

/** Whether `listing` is on `shelf`. */
export function onShelf(listing: Listing, shelf: ShelfId): boolean {
  if (shelf === 'discover') return listing.featured || listing.recommended
  if (shelf === 'installed') return listing.installs.length > 0
  if (shelf === 'updates') return hasUpdate(listing)
  const [group, kind] = shelf.split(':') as ['package' | 'capability', string]
  return group === 'package'
    ? listing.ref.kind === kind
    : componentCount(listing, kind as ComponentKind) > 0
}

/** How many listings each shelf holds; a shelf with none is left out. */
export function shelfCounts(listings: readonly Listing[]): Partial<Record<ShelfId, number>> {
  const counts: Partial<Record<ShelfId, number>> = {}
  for (const shelf of SHELVES) {
    const count = listings.filter((listing) => onShelf(listing, shelf)).length
    if (count > 0) counts[shelf] = count
  }
  return counts
}
