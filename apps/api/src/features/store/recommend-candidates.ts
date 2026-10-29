import type { Listing, RecommendRequest, RecommendResponse, StoreActor } from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import { refKey, refOf } from './index-rows'
import type { Interest } from './recommend-interests'
import { refOfStoreHit, relevance, STORE_SEARCH_DOMAIN } from './search-provider'
import type { StoreItemMeaningPort, StoreSearchPort } from './service-types'

/**
 * ONE INTEREST'S CANDIDATES (`docs/internals/store.md`, "Recommendations"), `[key, score]` best
 * first, on the scale the Store's search scores a hit.
 *
 * Most interests are text and ask the Store's search by meaning. A group of installs asks with
 * what its packages are: the mean of the vectors their cards are stored with, each member weighed
 * by how lately it was installed, so nothing is embedded and a terse summary ("A glyph tool")
 * does not hide what a package does. While none of them has a vector yet, the group asks with its
 * names and summaries instead.
 */

/** Hits each interest brings: enough for the fusion and the diversity to choose from. */
export const CANDIDATES = 30

/**
 * How far below a search's bar what is near the installs may be. Their mean is not a question
 * with an answer that stands out: the members themselves are what is nearest, and the packages
 * like them come after, a deviation or so lower (measured with EmbeddingGemma 2 on the golden
 * set, `recommend-eval.integration.test.ts`: beside two installed SQL databases, MongoDB at z
 * 1.6 under a bar of 2.2, fonts and music under 0.3).
 */
const LIKE_SLACK = 1

type Answer = {
  hits: Array<readonly [string, number]>
  strategy: RecommendResponse['strategy']
}

export async function candidatesOf(
  deps: {
    index: Pick<StoreIndexRepository, 'byRefs'>
    search: StoreSearchPort
    similarToItems?: StoreItemMeaningPort
    /** A listing's static score, which breaks near ties as it does in a search. */
    staticOf?: (listing: Listing) => number
  },
  actor: StoreActor,
  request: RecommendRequest,
  interest: Interest,
): Promise<Answer> {
  if (interest.members?.length && deps.similarToItems) {
    // The group's own members come back nearest; they are asked past.
    const matches = await deps
      .similarToItems(actor.userId, interest.members, {
        limit: CANDIDATES + interest.members.length,
      })
      .catch(() => null)
    if (matches) return byItems(deps, actor, matches)
  }
  const answer = await deps.search(actor.userId, {
    text: interest.text,
    domains: [STORE_SEARCH_DOMAIN],
    limit: CANDIDATES,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    providerOptions: { filters: { installed: false }, related: true },
  })
  return {
    hits: answer.hits.flatMap((hit) => {
      const ref = refOfStoreHit(hit)
      return ref ? [[refKey(ref), hit.score] as const] : []
    }),
    strategy: answer.strategy,
  }
}

/** What the members' vectors are near, past the gate and not installed, scored as a search does. */
async function byItems(
  deps: {
    index: Pick<StoreIndexRepository, 'byRefs'>
    staticOf?: (listing: Listing) => number
  },
  actor: StoreActor,
  matches: ReadonlyArray<{ key: string; z: number; gate: number }>,
): Promise<Answer> {
  const near = matches.filter((match) => match.z >= match.gate - LIKE_SLACK)
  const listings = await deps.index.byRefs(
    actor.userId,
    near.flatMap((match) => refOf(match.key) ?? []),
    { installed: false },
  )
  const hits = near.flatMap((match) => {
    const listing = listings.get(match.key)
    if (!listing) return []
    const tie = Math.min(1, (deps.staticOf?.(listing) ?? 0) / 3)
    return [[match.key, relevance(match.z, tie)] as const]
  })
  return {
    hits: hits.sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES),
    strategy: { mode: 'hybrid' },
  }
}
