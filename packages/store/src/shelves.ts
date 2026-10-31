import {
  PACKAGE_KINDS,
  type ComponentKind,
  type Listing,
  type PackageKind,
  type StoreJob,
} from './contract'

/**
 * A Store section, derived from listings (`docs/internals/store.md`, "Hierarchy"): Discover, a
 * shelf for each package kind that is only ever a package (mini apps, plugins), one per browsable
 * component kind, and the person's library. A skill, an agent and an MCP server are also package
 * kinds, but each has ONE shelf, its capability: it lists the standalone ones and those inside
 * plugins together, so no word names two shelves.
 * A shelf no listing is on is hidden, so a new kind needs no screen of its own.
 */
/** The package kinds that have a shelf of packages of their own. */
export const PACKAGE_SHELF_KINDS = ['mini-app', 'plugin'] as const satisfies readonly PackageKind[]

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

/**
 * What a package of each kind can give that a person browses by: a plugin any of it, a mini app its
 * commands, a standalone skill, agent or MCP server itself.
 */
const GIVES: Record<PackageKind, readonly BrowsableComponentKind[]> = {
  plugin: BROWSABLE_COMPONENT_KINDS,
  'mini-app': ['command'],
  skill: ['skill'],
  agent: ['agent'],
  'mcp-server': ['mcp-server'],
}

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
  ...PACKAGE_SHELF_KINDS.map(packageShelf),
  ...BROWSABLE_COMPONENT_KINDS.map(capabilityShelf),
  'installed',
  'updates',
  'yours',
  'project',
]

// `package:<kind>` also narrows a list for any kind (a source's page, the library's kind filter).
const KNOWN = new Set<string>([...SHELVES, ...PACKAGE_KINDS.map(packageShelf)])

/** A shelf id from a query or a tab payload, or null when it names no shelf. */
export function parseShelf(raw: unknown): ShelfId | null {
  return typeof raw === 'string' && KNOWN.has(raw) ? (raw as ShelfId) : null
}

/**
 * The package kinds whose listings a shelf lists: its own kind for a package shelf, the kinds that
 * can give its component for a capability shelf, none for Discover and the library, which span
 * every kind.
 */
export function shelfKinds(shelf: ShelfId): readonly PackageKind[] {
  if (shelf.startsWith('package:')) return [shelf.slice(8) as PackageKind]
  if (!shelf.startsWith('capability:')) return []
  const component = shelf.slice(11) as BrowsableComponentKind
  return PACKAGE_KINDS.filter((kind) => GIVES[kind].includes(component))
}

/** An install or update in flight. */
export const isActiveJob = (job: StoreJob | undefined): boolean =>
  job !== undefined && ['queued', 'downloading', 'installing'].includes(job.phase)

/** How many of a component a listing contains: 0 when it has none or does not know. */
export const componentCount = (listing: Listing, kind: ComponentKind): number =>
  listing.contents === 'unknown' ? 0 : (listing.contents[kind] ?? 0)

export const hasUpdate = (listing: Listing): boolean =>
  !listing.incompatible && listing.installs.some((install) => install.updateTo !== undefined)
