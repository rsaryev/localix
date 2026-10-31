import type { RecommendRequest, RecommendResponse, StoreActor } from '@localixai/store'

import { refKey } from './index-rows'

/**
 * RECOMMENDATIONS, WORKED OUT IN THE BACKGROUND (`docs/internals/store.md`, "Recommendations"):
 * a client reports its working set and returns at once; the answer is worked out off the request
 * path, kept in memory, and the `store-recommendations` topic is poked when it moved, so readers
 * pull it (P11). It is derived data (P9): nothing here is stored, and a restart works it out again
 * from the Store and the working set. A Store change (an install, a sync, the meaning model
 * becoming ready) works every remembered set out again; an answer that did not move pokes nobody.
 */

/** How long a working set settles before it is worked out: tabs open in bursts. */
const SETTLE_MS = 1_500
/** Working sets remembered: one per open project and chat, the oldest forgotten first. */
const REMEMBERED = 16

export type RecommendationWhere = Pick<RecommendRequest, 'projectId' | 'sessionId'>

export interface RecommendationRead extends RecommendResponse {
  /** Not worked out yet for this working set: the answer is the previous one, or nothing. */
  pending: boolean
}

interface Entry {
  actor: StoreActor
  request: RecommendRequest
  /** The working set the answer is for; a report of the same set changes nothing. */
  asked: string
  answer: RecommendResponse | null
  answered: string | null
  pending: boolean
  cancel: (() => void) | null
}

const keyOf = (actor: StoreActor, where: RecommendationWhere) =>
  JSON.stringify([actor.userId, where.projectId ?? null, where.sessionId ?? null])
const workingOf = (request: RecommendRequest) =>
  JSON.stringify(request.references.map((reference) => [reference.kind, reference.token]))
const answerOf = (answer: RecommendResponse) =>
  JSON.stringify([
    answer.strategy.mode,
    answer.matched,
    answer.listings.map((listing) => [refKey(listing.ref), answer.reasons[refKey(listing.ref)]]),
  ])

/** The answer without one listing, its reason and its place among the matched. */
function without(answer: RecommendResponse, key: string): RecommendResponse {
  const at = answer.listings.findIndex((listing) => refKey(listing.ref) === key)
  if (at < 0) return answer
  const { [key]: _gone, ...reasons } = answer.reasons
  return {
    ...answer,
    listings: answer.listings.filter((_, index) => index !== at),
    matched: at < answer.matched ? answer.matched - 1 : answer.matched,
    reasons,
  }
}

export function createRecommendationBoard(deps: {
  compute: (actor: StoreActor, request: RecommendRequest) => Promise<RecommendResponse>
  /** Run `work` later; returns its cancel. Injected so tests decide when it runs. */
  schedule?: (work: () => void) => () => void
}) {
  const schedule =
    deps.schedule ??
    ((work: () => void) => {
      const timer = setTimeout(work, SETTLE_MS)
      return () => clearTimeout(timer)
    })
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  const running = new Set<Promise<void>>()

  async function work(entry: Entry) {
    entry.cancel = null
    const asked = entry.asked
    try {
      const answer = await deps.compute(entry.actor, entry.request)
      // A newer working set was reported meanwhile: its own work answers it.
      if (entry.asked !== asked) return
      const answered = answerOf(answer)
      const moved = answered !== entry.answered
      entry.answer = answer
      entry.answered = answered
      entry.pending = false
      if (moved) for (const listener of listeners) listener()
    } catch {
      // The last answer stands; the next change works it out again.
      entry.pending = false
    }
  }

  function plan(entry: Entry) {
    entry.cancel?.()
    entry.pending = true
    entry.cancel = schedule(() => {
      const done = work(entry).finally(() => running.delete(done))
      running.add(done)
    })
  }

  function remember(actor: StoreActor, request: RecommendRequest): Entry {
    const key = keyOf(actor, request)
    const known = entries.get(key)
    if (known) {
      // Most recently used last, so the first one is the one to forget.
      entries.delete(key)
      entries.set(key, known)
      return known
    }
    const entry: Entry = {
      actor,
      request,
      asked: '',
      answer: null,
      answered: null,
      pending: false,
      cancel: null,
    }
    entries.set(key, entry)
    for (const [oldest, forgotten] of entries) {
      if (entries.size <= REMEMBERED) break
      forgotten.cancel?.()
      entries.delete(oldest)
    }
    return entry
  }

  function report(actor: StoreActor, request: RecommendRequest) {
    const entry = remember(actor, request)
    const asked = workingOf(request)
    if (entry.asked === asked && entry.answer) return
    entry.request = request
    entry.asked = asked
    plan(entry)
  }

  return {
    /** The working set moved: it is worked out once it settles, off the request path. */
    report,

    /** The answer for a project and chat; one nobody reported for is worked out from them alone. */
    async read(actor: StoreActor, where: RecommendationWhere): Promise<RecommendationRead> {
      const known = entries.get(keyOf(actor, where))
      if (!known) report(actor, { ...where, references: [] })
      const entry = known ?? entries.get(keyOf(actor, where))!
      return {
        listings: entry.answer?.listings ?? [],
        matched: entry.answer?.matched ?? 0,
        strategy: entry.answer?.strategy ?? { mode: 'hybrid' },
        reasons: entry.answer?.reasons ?? {},
        pending: entry.pending,
      }
    },

    /**
     * The person turned a package down: it leaves their remembered answers at once, and each is
     * worked out again to fill its place. The caller pokes the readers (`poke`).
     */
    exclude(userId: string, key: string) {
      for (const entry of entries.values()) {
        if (entry.actor.userId !== userId) continue
        if (entry.answer) {
          entry.answer = without(entry.answer, key)
          entry.answered = answerOf(entry.answer)
        }
        plan(entry)
      }
    },

    /** What the Store lists or how it searches changed: every remembered set is worked out again. */
    refresh() {
      for (const entry of entries.values()) plan(entry)
    },

    /** Tell every reader to read again: something they show beside the answers moved. */
    poke() {
      for (const listener of listeners) listener()
    },

    /** Hear every answer that moved; returns the unsubscribe. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    /** Resolves when the work started so far is done. */
    settled: async (): Promise<void> => {
      while (running.size > 0) await Promise.all(running)
    },
  }
}
