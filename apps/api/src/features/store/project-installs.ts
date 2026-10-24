import type { Listing, ListingRef, StoreInstall, StoreProvider } from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import type { IndexFilters } from './index-repository-filters'
import { refKey } from './index-rows'

/**
 * THE OPEN PROJECT'S INSTALLS ON A PAGE (`docs/internals/store.md`, "Step 2c API as built"). The index
 * holds the person's own installs; a project's are asked of the providers that have them, on each
 * read, and laid over the page: a listing shows them beside the person's, and the first page of
 * the installed shelf adds what is installed only in that project.
 */
export async function withProjectInstalls<P extends { listings: Listing[] }>(
  page: P,
  deps: {
    providers: readonly StoreProvider[]
    index: Pick<StoreIndexRepository, 'byRefs'>
    userId: string
    projectId: string
    filters: IndexFilters
    /** The first page of a browse: not a search, not a later page. */
    first: boolean
  },
): Promise<P> {
  const actor = { userId: deps.userId, projectId: deps.projectId }
  const found = (
    await Promise.all(
      deps.providers.map(async (provider) =>
        provider.projectInstalls
          ? (await provider.projectInstalls(actor).catch(() => [])).map((entry) => ({
              ref: { kind: provider.kind, id: entry.id } as ListingRef,
              installs: entry.installs,
            }))
          : [],
      ),
    )
  )
    .flat()
    .filter((entry) => entry.installs.length > 0)
  if (found.length === 0) return page
  const installsOf = new Map(found.map((entry) => [refKey(entry.ref), entry.installs]))

  const overlaid = (listing: Listing): Listing => {
    const own: StoreInstall[] | undefined = installsOf.get(refKey(listing.ref))
    if (!own) return listing
    const personal = listing.installs.filter((install) => install.scope !== 'project')
    return { ...listing, installs: [...personal, ...own] }
  }
  const listings = page.listings.map(overlaid)
  const { filters } = deps
  const installedShelf = filters.shelf === 'installed' || filters.installed === true
  if (!installedShelf || !deps.first) return { ...page, listings }

  const shown = new Set(listings.map((listing) => refKey(listing.ref)))
  const missing = found.filter((entry) => !shown.has(refKey(entry.ref))).map((entry) => entry.ref)
  // What the index knows of the person's own installs does not narrow a project's.
  const { shelf: _shelf, installed: _installed, scope: _scope, ...narrowing } = filters
  const more = await deps.index.byRefs(deps.userId, missing, narrowing)
  return { ...page, listings: [...[...more.values()].map(overlaid), ...listings] }
}
