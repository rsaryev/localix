import type {
  Listing,
  ListingRef,
  RecommendEvent,
  RecommendRequest,
  StoreActor,
} from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import type { ProjectFacts } from './project-signals'
import { refKey } from './index-rows'
import { recommendOf } from './recommend'
import { createRecommendationBoard, type RecommendationWhere } from './recommend-board'
import { memoryDismissals, memoryRecommendationEvents } from './recommend-memory'
import type {
  StoreContextPort,
  StoreDismissalsPort,
  StoreItemMeaningPort,
  StoreRecommendationEventsPort,
  StoreSearchPort,
} from './service-types'

const DAY_MS = 24 * 60 * 60 * 1000
/** How far back an install is counted for the recommendation that showed it. */
const ATTRIBUTION_MS = 30 * DAY_MS
/** How far back the stats read. */
const STATS_MS = 90 * DAY_MS

/**
 * The Store service's recommendations (`docs/internals/store.md`, "Recommendations"): worked out
 * now (`recommend.ts`) or in the background (`recommend-board.ts`), and what the person turns
 * down. A harness without a database keeps its dismissals in memory.
 */
export function recommendationService(deps: {
  index: Pick<StoreIndexRepository, 'byRefs' | 'page' | 'suited'>
  search: StoreSearchPort
  context?: StoreContextPort
  projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
  projectFacts?: (userId: string, projectId: string | null | undefined) => Promise<ProjectFacts>
  dismissals?: StoreDismissalsPort
  events?: StoreRecommendationEventsPort
  similarToItems?: StoreItemMeaningPort
  staticOf?: (listing: Listing) => number
  now: () => number
  /** The person's index is built (the first time, it is waited for). */
  ready: (actor: StoreActor) => Promise<void>
  schedule?: (work: () => void) => () => void
}) {
  const dismissals = deps.dismissals ?? memoryDismissals()
  const events = deps.events ?? memoryRecommendationEvents()
  const ago = (ms: number) => new Date(deps.now() - ms).toISOString()
  async function recommend(actor: StoreActor, request: RecommendRequest) {
    await deps.ready(actor)
    return recommendOf(
      {
        index: deps.index,
        search: deps.search,
        ...(deps.context ? { context: deps.context } : {}),
        ...(deps.projectWords ? { projectWords: deps.projectWords } : {}),
        ...(deps.projectFacts ? { projectFacts: deps.projectFacts } : {}),
        dismissed: (userId) => dismissals.list(userId),
        exposure: (userId, since) => events.exposure(userId, new Date(since).toISOString()),
        installedAt: (userId, keys) => events.installedAt(userId, keys),
        ...(deps.similarToItems ? { similarToItems: deps.similarToItems } : {}),
        ...(deps.staticOf ? { staticOf: deps.staticOf } : {}),
        now: deps.now(),
      },
      actor,
      request,
    )
  }
  const board = createRecommendationBoard({
    compute: recommend,
    ...(deps.schedule ? { schedule: deps.schedule } : {}),
  })

  return {
    board,
    service: {
      /** What suits the working set, worked out now (`recommend.ts`). */
      recommend,
      /** The working set moved: worked out in the background (`recommend-board.ts`). */
      reportWorkingSet: (actor: StoreActor, request: RecommendRequest) =>
        board.report(actor, request),
      readRecommendations: (actor: StoreActor, where: RecommendationWhere) =>
        board.read(actor, where),
      /** How the Store searches changed (the meaning model is ready): worked out again. */
      refreshRecommendations: () => board.refresh(),
      /** Hear every recommendation answer that moved; returns the unsubscribe. */
      subscribeRecommendations: board.subscribe,
      recommendationsSettled: board.settled,

      /**
       * The person is not interested in a package, or takes that back. Either way readers are
       * poked: the list of what was turned down moved even when no answer did.
       */
      async dismissRecommendation(actor: StoreActor, ref: ListingRef, dismissed: boolean) {
        await dismissals.set(actor.userId, ref, dismissed ? 'not-interested' : null)
        if (dismissed) board.exclude(actor.userId, refKey(ref))
        else board.refresh()
        board.poke()
      },

      /** Recommendations a surface showed, or the one the person opened from it. */
      recordRecommendationEvents: (actor: StoreActor, shown: readonly RecommendEvent[]) =>
        events.record(actor.userId, shown, new Date(deps.now()).toISOString()),
      /** Per kind of interest, the last ninety days: shown, opened, installed. */
      recommendationStats: (actor: StoreActor) => events.stats(actor.userId, ago(STATS_MS)),

      /** What is kept out of the person's recommendations, newest first, as the Store lists it. */
      async dismissedRecommendations(actor: StoreActor) {
        await deps.ready(actor)
        const entries = await dismissals.entries(actor.userId)
        const found = await deps.index.byRefs(
          actor.userId,
          entries.map((entry) => entry.ref),
        )
        return entries.flatMap((entry) => {
          const listing = found.get(refKey(entry.ref))
          return listing ? [{ listing, reason: entry.reason }] : []
        })
      },
    },
    /** A package the person removed through the Store is not recommended to them again. */
    removed: (actor: StoreActor, ref: ListingRef) =>
      dismissals.set(actor.userId, ref, 'removed').catch(() => {}),
    /** An install, kept with its time: counted for the recommendation that showed it lately. */
    installed: (actor: StoreActor, ref: ListingRef) =>
      events
        .installed(actor.userId, ref, new Date(deps.now()).toISOString(), ago(ATTRIBUTION_MS))
        .catch(() => {}),
  }
}
