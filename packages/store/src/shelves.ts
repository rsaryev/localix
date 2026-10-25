import {
  PACKAGE_KINDS,
  type ComponentKind,
  type Listing,
  type PackageKind,
  type StoreJob,
} from './contract'

/**
 * A Store section, derived from listings (`docs/internals/store.md`, "Hierarchy"): Discover, one
 * shelf per package kind, one per browsable component kind a listing contains, and the person's
 * library.
 * A shelf no listing is on is hidden, so a new kind needs no screen of its own.
 */
/**
 * The component kinds a person browses by, each a capability shelf. The rest — a mini app's
 * screen, its backend and the tools it gives the agent, a plugin's monitors and themes — are how
 * a package works, not what anyone looks for: they stay facts on its page ("What's inside").
 */
export const BROWSABLE_COMPONENT_KINDS = [
  'skill',
  'agent',
  'command',
  'hook',
  'mod',
  'mcp-server',
  'lsp-server',
  'output-style',
] as const satisfies readonly ComponentKind[]
export type BrowsableComponentKind = (typeof BROWSABLE_COMPONENT_KINDS)[number]

export type ShelfId =
  | 'discover'
  | 'installed'
  | 'updates'
  | 'yours'
  | 'project'
  | `package:${PackageKind}`
  | `capability:${BrowsableComponentKind}`

export const packageShelf = (kind: PackageKind): ShelfId => `package:${kind}`
export const capabilityShelf = (kind: BrowsableComponentKind): ShelfId => `capability:${kind}`

/** Every shelf, in the order the Store lists them. */
export const SHELVES: readonly ShelfId[] = [
  'discover',
  ...PACKAGE_KINDS.map(packageShelf),
  ...BROWSABLE_COMPONENT_KINDS.map(capabilityShelf),
  'installed',
  'updates',
  'yours',
  'project',
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
  if (shelf === 'yours' || shelf === 'project')
    return listing.authored === (shelf === 'yours' ? 'user' : 'project')
  const [group, kind] = shelf.split(':') as ['package' | 'capability', string]
  return group === 'package'
    ? listing.ref.kind === kind
    : componentCount(listing, kind as ComponentKind) > 0
}

/**
 * How many rows each shelf shows; a shelf with none is left out. A capability shelf lists
 * components, so it counts them: a package with three commands is three on Commands.
 */
export function shelfCounts(listings: readonly Listing[]): Partial<Record<ShelfId, number>> {
  const counts: Partial<Record<ShelfId, number>> = {}
  for (const shelf of SHELVES) {
    const kind = shelf.startsWith('capability:') ? (shelf.slice(11) as ComponentKind) : null
    const count = listings.reduce(
      (sum, listing) =>
        sum + (kind ? componentCount(listing, kind) : onShelf(listing, shelf) ? 1 : 0),
      0,
    )
    if (count > 0) counts[shelf] = count
  }
  return counts
}
