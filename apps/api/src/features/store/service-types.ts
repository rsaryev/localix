import type {
  ListingRef,
  StoreProvider,
  RecommendEvent,
  Scope,
  ShelfId,
  StoreCategory,
  Trust,
  WorkingReference,
} from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import type { ProjectFacts } from './project-signals'

/** What narrows a page: a shelf, a search, a scope, installed or not, and the facets' filters. */
export interface ListingQuery {
  shelf?: ShelfId
  q?: string
  scope?: Scope
  installed?: boolean
  category?: StoreCategory
  source?: string
  trust?: Trust
  projectId?: string
  cursor?: string
  limit?: number
}

/** The global search service, as the Store asks it (wired in `bootstrap/`, A4). */
export type StoreSearchPort = (
  userId: string,
  request: {
    text: string
    domains: string[]
    limit: number
    cursor?: string
    projectId?: string | null
    providerOptions: unknown
  },
) => Promise<{
  /** Best first; `score` is the hit's relevance in [0, 1]. */
  hits: Array<{ id: string; score: number }>
  nextCursor?: string
  strategy: { mode: 'lexical' | 'hybrid'; reason?: string }
}>

/**
 * What is near these listings (`kind:id`, weighed) in the Store's semantic collection, by the
 * vectors they are stored with; null while none of them has one.
 */
export type StoreItemMeaningPort = (
  userId: string,
  members: ReadonlyArray<{ key: string; weight: number }>,
  options: { limit: number },
) => Promise<Array<{ key: string; z: number; gate: number }> | null>

/** One piece of the working set: its text, its priority, and what the person calls it. */
export interface WorkingPiece {
  content: string
  priority: number
  /** The tab or chip it was read from (`compose.yaml`); absent for what a provider added. */
  label?: string
  /** The person linked it as a chip, rather than having it open. */
  linked?: boolean
}

/**
 * What the working set says, as Context Fabric admitted it for `recommendation` (wired in
 * `bootstrap/`, A4): each piece's text, priority and label. Whatever provider declares the
 * destination adds to it; the Store knows none of them.
 */
export type StoreContextPort = (
  userId: string,
  request: { projectId?: string; sessionId?: string; references: readonly WorkingReference[] },
) => Promise<readonly WorkingPiece[]>

/** Why a package is kept out of the person's recommendations. */
export type DismissalReason = 'not-interested' | 'removed'

/** What the person turned down for recommendations (`dismissals-repository.ts`, A4). */
export interface StoreDismissalsPort {
  /** Their dismissed listings, as `kind:id`. */
  list(userId: string): Promise<Set<string>>
  /** Each one with why, newest first. */
  entries(userId: string): Promise<Array<{ ref: ListingRef; reason: DismissalReason }>>
  /** Turn one down for this reason, or take it back (null). */
  set(userId: string, ref: ListingRef, reason: DismissalReason | null): Promise<void>
}

/** What happened to recommendations (`recommendation-events-repository.ts`, A4). */
export interface StoreRecommendationEventsPort {
  /** Shown or opened, at `at` (ISO 8601). Events older than the window are pruned. */
  record(userId: string, events: readonly RecommendEvent[], at: string): Promise<void>
  /**
   * An install, kept with its time; counted for what found it when the package was shown since
   * `since`, and for no interest otherwise.
   */
  installed(userId: string, ref: ListingRef, at: string, since: string): Promise<void>
  /** When these listings (`kind:id`) were last installed, for those the log still holds. */
  installedAt(userId: string, keys: readonly string[]): Promise<Map<string, string>>
  /** Per listing (`kind:id`) shown since `since`: on how many days, and whether it was opened. */
  exposure(userId: string, since: string): Promise<Map<string, { days: number; opened: boolean }>>
  /** Per kind of interest, since `since`: how many shown, opened and installed. */
  stats(
    userId: string,
    since: string,
  ): Promise<Record<string, { shown: number; opened: number; installed: number }>>
}

/** What `createStoreService` is built from (`bootstrap/store.ts`). */
export interface StoreServiceDeps {
  providers: readonly StoreProvider[]
  index: StoreIndexRepository
  /** The global search service; it reaches the provider this service registers. */
  search: StoreSearchPort
  /** The Store's semantic collection read its listings again. */
  resyncMeaning?: () => void
  /** These listings' cards changed: the semantic collection reads them alone again. */
  meaningChanged?: (keys: string[]) => void
  /** The open project's words, for the boost (`project-signals.ts`). */
  projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
  /** The open project's root names and dependencies, as written (`recommend-rules.ts`). */
  projectFacts?: (userId: string, projectId: string | null | undefined) => Promise<ProjectFacts>
  /** What the working set says, admitted for `recommendation` (`recommend.ts`). */
  workingContext?: StoreContextPort
  /** What the person turned down for recommendations (`dismissals-repository.ts`). */
  dismissals?: StoreDismissalsPort
  /** What happened to recommendations (`recommendation-events-repository.ts`). */
  recommendationEvents?: StoreRecommendationEventsPort
  /** What installed packages are near in the semantic collection (`recommend-candidates.ts`). */
  similarToItems?: StoreItemMeaningPort
  /** When background recommendations run (`recommend-board.ts`); tests run them by hand. */
  scheduleRecommendation?: (work: () => void) => () => void
  now?: () => number
}
