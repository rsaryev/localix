import {
  COMPONENT_KINDS,
  componentCount,
  hasUpdate,
  onShelf,
  shelfCounts,
  type Listing,
  type ListingRef,
  type Scope,
  type ShelfId,
  type StoreFacets,
} from '@localixai/store'

/** What narrows a page of listings: a shelf, a search, a scope and whether it is installed. */
export interface ListingQuery {
  shelf?: ShelfId
  q?: string
  scope?: Scope
  installed?: boolean
}

const keyOf = (ref: ListingRef) => `${ref.kind}\u0000${ref.id}`

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/**
 * THE STORE'S INDEX: an in-memory projection of every provider's listings, by ref, with a token
 * search and facet counts. It keeps nothing of its own — the Store rebuilds it from the providers
 * whenever one says it changed — so it can always be thrown away (P9).
 *
 * Search is local token matching: every word of the query must start a word of the listing's
 * name, display name, summary, tags or component names.
 */
export function createListingIndex(listings: readonly Listing[]) {
  const byRef = new Map(listings.map((listing) => [keyOf(listing.ref), listing]))
  const tokens = new Map(
    listings.map((listing) => [
      keyOf(listing.ref),
      words(
        [
          listing.name,
          listing.displayName,
          listing.summary,
          ...listing.tags,
          ...(listing.componentNames ?? []),
        ].join(' '),
      ),
    ]),
  )
  const matches = (listing: Listing, query: string[]) => {
    const own = tokens.get(keyOf(listing.ref)) ?? []
    return query.every((word) => own.some((token) => token.startsWith(word)))
  }

  return {
    get: (ref: ListingRef): Listing | undefined => byRef.get(keyOf(ref)),

    all: (): readonly Listing[] => listings,

    query(query: ListingQuery): Listing[] {
      const search = words(query.q ?? '')
      return listings.filter(
        (listing) =>
          (!query.shelf || onShelf(listing, query.shelf)) &&
          (!query.scope || listing.installs.some((install) => install.scope === query.scope)) &&
          (query.installed === undefined || listing.installs.length > 0 === query.installed) &&
          (search.length === 0 || matches(listing, search)),
      )
    },

    /** Counts over every listing, so the shelf navigation does not move with a filter. */
    facets(): StoreFacets {
      const count = (keys: (listing: Listing) => readonly (string | undefined)[]) => {
        const counts: Record<string, number> = {}
        for (const listing of listings)
          for (const key of keys(listing)) if (key) counts[key] = (counts[key] ?? 0) + 1
        return counts
      }
      return {
        shelves: shelfCounts(listings),
        kind: count((listing) => [listing.ref.kind]),
        component: count((listing) =>
          COMPONENT_KINDS.filter((kind) => componentCount(listing, kind) > 0),
        ),
        category: count((listing) => [listing.category]),
        source: count((listing) => [listing.source.id]),
        installed: listings.filter((listing) => listing.installs.length > 0).length,
        updates: listings.filter(hasUpdate).length,
      }
    },
  }
}

export type ListingIndex = ReturnType<typeof createListingIndex>
