import type { Listing, StoreActor, StoreFacets, StoreProvider } from '@localixai/store'

/**
 * WHAT THE OPEN PROJECT KEEPS IN ITS OWN FOLDER (`docs/internals/store.md`, "Yours and Project as
 * built"): listings with `authored: 'project'`, asked of the providers that have them on each
 * read and never indexed, because the index is the person's and a project's files belong to that
 * project alone. Without an open project there are none. A provider that cannot read them leaves
 * its own out and the rest still show.
 */
export async function projectAuthored(
  providers: readonly StoreProvider[],
  actor: StoreActor,
): Promise<Listing[]> {
  const { projectId } = actor
  if (!projectId) return []
  const asked = { ...actor, projectId }
  const lists = await Promise.all(
    providers.map((provider) =>
      provider.projectListings
        ? provider.projectListings(asked).catch(() => [])
        : Promise.resolve([]),
    ),
  )
  return lists.flat().map((listing) => ({ ...listing, authored: 'project' as const }))
}

/** Those whose name, summary or tags hold every word of a search. */
export function matching(listings: readonly Listing[], q: string | undefined): Listing[] {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const text = (l: Listing) => `${l.displayName} ${l.summary} ${l.tags.join(' ')}`.toLowerCase()
  return listings.filter((listing) => words.every((word) => text(listing).includes(word)))
}

/** The facets with the Project shelf's count, which the index cannot know. */
export function withProjectCount(facets: StoreFacets, count: number): StoreFacets {
  return count > 0 ? { ...facets, shelves: { ...facets.shelves, project: count } } : facets
}
