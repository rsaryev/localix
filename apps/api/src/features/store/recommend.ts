import type {
  Listing,
  RecommendReason,
  RecommendRequest,
  RecommendResponse,
  StoreActor,
} from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import { refKey, refOf } from './index-rows'
import { candidatesOf } from './recommend-candidates'
import { interestsOf, recencyOf } from './recommend-interests'
import { diversified, fused } from './recommend-rank'
import { suitedInterests } from './recommend-rules'
import type { ProjectFacts } from './project-signals'
import type { StoreContextPort, StoreItemMeaningPort, StoreSearchPort } from './service-types'

/**
 * RECOMMENDATIONS (`docs/internals/store.md`, "Recommendations"): what suits what the person works
 * on, found the way a search finds a listing, by meaning. There is no table of what to recommend
 * for what. It runs in stages, as recommenders do:
 *
 * 1. Interests (`recommend-interests.ts`): the working set as Context Fabric admits it, what the
 *    person chose to install (what they installed lately weighing more), and the open project's
 *    words, each its own query with a weight and a reason.
 * 2. Candidates (`recommend-candidates.ts`): each interest searches the Store's semantic
 *    collection, never what is installed; a group of installs asks with its packages' vectors.
 *    Beside them, the packages whose source says they are for an open file or the project's
 *    files and dependencies (`recommend-rules.ts`), each match an interest of its own.
 * 3. Fusion and filters (`recommend-rank.ts`): the answers fused into one list; what the person
 *    turned down (`dismissals-repository.ts`) is left out.
 * 4. Rest and diversity: a package shown day after day and never opened gives way (the person's
 *    own log, `recommendation-events-repository.ts`), and no publisher or interest takes the row
 *    while others are found.
 * 5. Fill: the row is never empty while anything is left to install — trusted packages by score,
 *    lifted by the project, then any listing, fill it to ten.
 */

/** Listings one answer carries. */
export const RECOMMENDED = 10
/** Installs read for the person's interests. */
const CHOSEN = 60

const TRUSTED: RecommendReason = { source: 'trusted' }

/** How far back showings count. */
const FATIGUE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
/** Days a package is shown before its showings count against it. */
const FREE_DAYS = 2
/** What each further day of showing without an open costs, down to the floor. */
const FATIGUE = 0.8
const FATIGUE_FLOOR = 0.4

/**
 * A package shown on several days and never opened rests: from the third day on, each day takes a
 * fifth of its score, down to 0.4, so the next suited one gets its place. Days, not showings: a
 * screen read twice is one look. Opening it once says the person looked, and it keeps its place.
 */
function rested(seen: { days: number; opened: boolean } | undefined): number {
  if (!seen || seen.opened || seen.days <= FREE_DAYS) return 1
  return Math.max(FATIGUE_FLOOR, FATIGUE ** (seen.days - FREE_DAYS))
}

export async function recommendOf(
  deps: {
    index: Pick<StoreIndexRepository, 'byRefs' | 'page' | 'suited'>
    search: StoreSearchPort
    context?: StoreContextPort
    projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
    /** The open project's root names and dependencies, as written (`recommend-rules.ts`). */
    projectFacts?: (userId: string, projectId: string | null | undefined) => Promise<ProjectFacts>
    /** What the person turned down, as `kind:id`. */
    dismissed?: (userId: string) => Promise<Set<string>>
    /** Per listing shown since then: on how many days, and whether it was opened. */
    exposure?: (
      userId: string,
      since: number,
    ) => Promise<ReadonlyMap<string, { days: number; opened: boolean }>>
    /** What installed packages are near, by their stored vectors (`recommend-candidates.ts`). */
    similarToItems?: StoreItemMeaningPort
    /** When these listings were last installed, for those the log holds. */
    installedAt?: (userId: string, keys: readonly string[]) => Promise<Map<string, string>>
    staticOf?: (listing: Listing) => number
    now?: number
  },
  actor: StoreActor,
  request: RecommendRequest,
): Promise<RecommendResponse> {
  const now = deps.now ?? Date.now()
  const [pieces, project, facts, suited, chosen, dismissed, exposure] = await Promise.all([
    deps.context?.(actor.userId, request) ?? [],
    deps.projectWords?.(actor.userId, request.projectId) ?? new Set<string>(),
    deps.projectFacts?.(actor.userId, request.projectId) ?? { files: [], dependencies: [] },
    deps.index.suited(actor.userId),
    // What the person chose: not what comes with Localix, nor what they wrote themselves.
    deps.index.page(actor.userId, { shelf: 'installed' }, { limit: CHOSEN }),
    deps.dismissed?.(actor.userId) ?? new Set<string>(),
    deps.exposure?.(actor.userId, now - FATIGUE_WINDOW_MS) ??
      new Map<string, { days: number; opened: boolean }>(),
  ])
  const installedAt =
    (await deps.installedAt?.(
      actor.userId,
      chosen.listings.map((listing) => refKey(listing.ref)),
    )) ?? new Map<string, string>()
  const ruled = suitedInterests(suited, {
    open: pieces.flatMap((piece) => piece.label ?? []),
    ...facts,
  })
  const asked = interestsOf(pieces, chosen.listings, project, recencyOf(installedAt, now))
  const interests = [...ruled.map((rule) => rule.interest), ...asked]
  const answers = [
    ...ruled.map((rule) => ({ hits: rule.hits, strategy: { mode: 'hybrid' as const } })),
    ...(await Promise.all(asked.map((interest) => candidatesOf(deps, actor, request, interest)))),
  ]
  const candidates = fused(
    answers.map((answer) => answer.hits.filter(([key]) => !dismissed.has(key))),
    interests.map((interest) => interest.weight),
  )
  const found = await deps.index.byRefs(
    actor.userId,
    candidates.flatMap((candidate) => refOf(candidate.key) ?? []),
  )
  const known = candidates
    .flatMap((candidate) => {
      const listing = found.get(candidate.key)
      const seen = exposure.get(candidate.key)
      return listing ? [{ ...candidate, score: candidate.score * rested(seen), listing }] : []
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  const picked = diversified(known, (candidate) => candidate.listing.publisher.name, RECOMMENDED)
  const reasons: Record<string, RecommendReason> = {}
  for (const candidate of picked) reasons[candidate.key] = interests[candidate.interest]!.reason
  const listings = await filled(
    deps.index,
    actor.userId,
    picked.map((candidate) => candidate.listing),
    [...project],
    dismissed,
  )
  for (const listing of listings.slice(picked.length)) reasons[refKey(listing.ref)] = TRUSTED
  return {
    listings,
    matched: picked.length,
    strategy: strategyOf(answers),
    reasons,
  }
}

/** Meaning answered when any interest's search could ask it; otherwise why it could not. */
function strategyOf(answers: ReadonlyArray<{ strategy: RecommendResponse['strategy'] }>) {
  return (
    answers.find((answer) => answer.strategy.mode === 'hybrid')?.strategy ??
    answers[0]?.strategy ?? { mode: 'hybrid' as const }
  )
}

/** The answer topped up to ten: trusted packages by score first, then any, none installed. */
async function filled(
  index: Pick<StoreIndexRepository, 'page'>,
  userId: string,
  found: Listing[],
  boost: string[],
  dismissed: ReadonlySet<string>,
): Promise<Listing[]> {
  const out = [...found]
  const seen = new Set([...dismissed, ...found.map((listing) => refKey(listing.ref))])
  for (const filters of [{ installed: false, trusted: true }, { installed: false }]) {
    if (out.length >= RECOMMENDED) break
    const page = await index.page(userId, filters, {
      limit: RECOMMENDED * 2 + dismissed.size,
      boost,
    })
    for (const listing of page.listings) {
      if (out.length >= RECOMMENDED) break
      if (seen.has(refKey(listing.ref))) continue
      seen.add(refKey(listing.ref))
      out.push(listing)
    }
  }
  return out
}
