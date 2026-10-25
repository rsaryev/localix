import {
  PACKAGE_KINDS,
  STORE_CATEGORIES,
  type Collection,
  type DiscoverResponse,
  type Editorial,
  type Listing,
  type ListingRef,
  type PackageKind,
  type StoreActor,
  type StoreProvider,
} from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import { refKey } from './index-rows'

/**
 * WHAT DISCOVER SHOWS (`docs/internals/store.md`, "Discover as built"): the collections
 * editorial sources pick, and the rows the Store computes — Start here (what editorial sources
 * recommend, every kind), For this project (what suits the open project), New & updated, and one
 * row per package kind by score. A community listing never reaches Start here or a collection. Every listing an item names comes with the answer.
 */

const ROW = 12
/** "New": a version published in the last quarter. */
const NEW_MS = 90 * 24 * 60 * 60 * 1000
const KIND_TITLES: Record<PackageKind, string> = {
  'mini-app': 'Mini apps',
  plugin: 'Plugins',
  'mcp-server': 'MCP servers',
  skill: 'Skills',
  agent: 'Agents',
}

export async function discoverOf(deps: {
  index: StoreIndexRepository
  providers: readonly StoreProvider[]
  actor: StoreActor
  projectWords: Set<string>
  now: number
}): Promise<DiscoverResponse> {
  const { index, actor } = deps
  const userId = actor.userId
  const refs = (listings: readonly Listing[]) => listings.map((listing) => listing.ref)
  const top = async (filters: Parameters<StoreIndexRepository['page']>[1], boosted = false) =>
    refs(
      (
        await index.page(userId, filters, {
          limit: ROW,
          ...(boosted ? { boost: [...deps.projectWords], boosted } : {}),
        })
      ).listings,
    )

  const editorial: Editorial[] = (
    await Promise.all(
      deps.providers.map((provider) =>
        provider.editorial
          ? provider.editorial().catch((): Editorial[] => [])
          : Promise.resolve<Editorial[]>([]),
      ),
    )
  ).flat()
  // What the picks name, as the person sees it, never a community listing.
  const picked = await index.byRefs(
    userId,
    editorial.flatMap((pick) => pick.collections.flatMap((collection) => collection.items)),
    { trusted: true },
  )
  const kept = (items: readonly ListingRef[]) => items.filter((ref) => picked.has(refKey(ref)))

  const row = (id: string, title: string, items: ListingRef[], subtitle?: string): Collection[] =>
    items.length ? [{ id, title, ...(subtitle ? { subtitle } : {}), style: 'row', items }] : []

  const [start, project, fresh, facets, ...kinds] = await Promise.all([
    // No editorial source could be read (offline, or a catalog not published yet): the trusted
    // listings by score are what Start here leads with.
    top({ recommended: true, trusted: true }).then((found) =>
      found.length ? found : top({ trusted: true }),
    ),
    deps.projectWords.size ? top({}, true) : Promise.resolve([]),
    index.newest(userId, { updatedSince: new Date(deps.now - NEW_MS).toISOString() }, ROW),
    index.facets(userId, {}),
    ...PACKAGE_KINDS.map((kind) => top({ shelf: `package:${kind}` })),
  ])

  const rows: Collection[] = [
    ...row('start', 'Start here', start, 'What Localix suggests first'),
    ...row('project', 'For this project', project, 'Suits what this project is written in'),
    ...editorial.flatMap((pick) =>
      pick.collections.flatMap((collection) => {
        const items = kept(collection.items)
        return items.length ? [{ ...collection, items, source: pick.source }] : []
      }),
    ),
    ...row('new', 'New & updated', refs(fresh)),
    ...PACKAGE_KINDS.flatMap((kind, at) => row(`kind:${kind}`, KIND_TITLES[kind], kinds[at]!)),
  ]

  const listings = await index.byRefs(
    userId,
    rows.flatMap((found) => found.items),
  )
  return {
    updates: { count: facets.updates },
    rows,
    categories: STORE_CATEGORIES.flatMap((id) =>
      facets.category[id] ? [{ id, label: id, count: facets.category[id] }] : [],
    ),
    listings: [...listings.values()],
  }
}

/** More from a listing's publisher, and what shares its category and tags; best first. */
export async function relatedOf(
  index: StoreIndexRepository,
  userId: string,
  listing: Listing,
): Promise<{ related: ListingRef[]; similar: ListingRef[]; linked: Listing[] }> {
  const own = refKey(listing.ref)
  const others = (listings: readonly Listing[]) =>
    listings.filter((other) => refKey(other.ref) !== own)
  const [publisher, category] = await Promise.all([
    index.page(userId, { publisher: listing.publisher.name }, { limit: ROW + 1 }),
    listing.category
      ? index.page(userId, { category: listing.category as never }, { limit: 50 })
      : Promise.resolve({ listings: [] as Listing[] }),
  ])
  const tags = new Set(listing.tags)
  const related = others(publisher.listings).slice(0, ROW)
  const similar = others(category.listings)
    .filter((other) => tags.size === 0 || other.tags.some((tag) => tags.has(tag)))
    .slice(0, ROW)
  const linked = new Map([...related, ...similar].map((other) => [refKey(other.ref), other]))
  return {
    related: related.map((other) => other.ref),
    similar: similar.map((other) => other.ref),
    linked: [...linked.values()],
  }
}
