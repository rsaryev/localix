import type { Listing, RecommendRequest, RecommendResponse, StoreActor } from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import { refKey } from './index-rows'
import { refOfStoreHit, STORE_SEARCH_DOMAIN } from './search-provider'
import type { StoreContextPort, StoreSearchPort } from './service-types'

/**
 * RECOMMENDATIONS (`docs/internals/store.md`, "Recommendations"): what suits what the person works
 * on, found the way a search finds a listing, by meaning. There is no table of what to recommend
 * for what: the working set goes through Context Fabric (`StoreContextPort`), every provider that
 * declares the `recommendation` destination adds to it, and the admitted text is the query of the
 * Store's semantic collection. What the person installed is a piece of it too, so the answer
 * improves as they use the Store, and the open project's signals are the last piece. The row is
 * never empty: what meaning finds comes first, and trusted packages by score, lifted by the
 * project, fill the rest of the ten.
 */

/** Listings one answer carries. */
export const RECOMMENDED = 10
/**
 * How much text the query carries: a few pieces of each kind, not a whole file. The embedding
 * model reads a bounded window anyway, and a long query drowns the piece the person linked.
 */
export const QUERY_CHARS = 2_000
/** No piece takes more than this share of the query, so one large tab cannot crowd out the rest. */
const PIECE_CHARS = 600
/** Installs read as "what the person uses": the most recent few. */
const INSTALLED_PIECES = 20
/** Below what the working set says, above the project's words. */
const INSTALLED_PRIORITY = -500
const PROJECT_PRIORITY = -1_000

/** The query text: the highest-priority pieces first, each clipped, within the budget. */
export function recommendationQuery(
  pieces: ReadonlyArray<{ content: string; priority: number }>,
  budget = QUERY_CHARS,
): string {
  const parts: string[] = []
  let left = budget
  for (const piece of [...pieces].sort((a, b) => b.priority - a.priority)) {
    const text = piece.content.trim().slice(0, Math.min(PIECE_CHARS, left))
    if (!text) continue
    parts.push(text)
    left -= text.length + 1
    if (left <= 0) break
  }
  return parts.join('\n')
}

export async function recommendOf(
  deps: {
    index: Pick<StoreIndexRepository, 'byRefs' | 'page'>
    search: StoreSearchPort
    context?: StoreContextPort
    projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
  },
  actor: StoreActor,
  request: RecommendRequest,
): Promise<RecommendResponse> {
  const [pieces, project, installed] = await Promise.all([
    deps.context?.(actor.userId, request) ?? [],
    deps.projectWords?.(actor.userId, request.projectId) ?? new Set<string>(),
    deps.index.page(actor.userId, { installed: true }, { limit: INSTALLED_PIECES }),
  ])
  const text = recommendationQuery([
    ...pieces,
    ...installed.listings.map((listing) => ({
      content: [listing.displayName, listing.summary, ...listing.tags].join(' '),
      priority: INSTALLED_PRIORITY,
    })),
    ...(project.size ? [{ content: [...project].join(' '), priority: PROJECT_PRIORITY }] : []),
  ])
  const answer = text
    ? await deps.search(actor.userId, {
        text,
        domains: [STORE_SEARCH_DOMAIN],
        limit: RECOMMENDED,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        providerOptions: { filters: { installed: false }, related: true },
      })
    : { hits: [], strategy: { mode: 'hybrid' as const } }
  const refs = answer.hits.flatMap((hit) => refOfStoreHit(hit) ?? []).slice(0, RECOMMENDED)
  const found = await deps.index.byRefs(actor.userId, refs)
  const listings = refs.flatMap((ref) => found.get(refKey(ref)) ?? [])
  return {
    listings: await filled(deps.index, actor.userId, listings, [...project]),
    matched: listings.length,
    strategy: answer.strategy,
  }
}

/** The answer topped up to ten: trusted packages by score first, then any, none installed. */
async function filled(
  index: Pick<StoreIndexRepository, 'page'>,
  userId: string,
  found: Listing[],
  boost: string[],
): Promise<Listing[]> {
  const out = [...found]
  const seen = new Set(found.map((listing) => refKey(listing.ref)))
  for (const filters of [{ installed: false, trusted: true }, { installed: false }]) {
    if (out.length >= RECOMMENDED) break
    const page = await index.page(userId, filters, { limit: RECOMMENDED * 2, boost })
    for (const listing of page.listings) {
      if (out.length >= RECOMMENDED) break
      if (seen.has(refKey(listing.ref))) continue
      seen.add(refKey(listing.ref))
      out.push(listing)
    }
  }
  return out
}
