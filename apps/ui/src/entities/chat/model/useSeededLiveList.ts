import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { enqueueMicrotask } from '@/shared/lib/enqueueMicrotask'

/**
 * The seed + live-channel pattern, once.
 *
 * A session-scoped list (inline review suggestions, the agent-edit ledger, …) has
 * TWO sources and neither alone is sufficient:
 *
 *  - a one-shot REST fetch, which is the only way state that already existed when
 *    the tab opened can appear (no stream event fires for the past); and
 *  - the LIVE list patched onto the session by `applyStreamEventToSession`, which is
 *    the only way a change made *while you watch* appears — but which the server
 *    publishes only to the session that CAUSED it (act on a suggestion the reviewer
 *    sub-agent created and nothing streams to the parent).
 *
 * So the two race, and the rule is: prefer whichever is FRESHER. A live event newer
 * than the last fetch wins; an explicit `reload()` after an action beats a stale live
 * list. This hook owns that rule so a caller only says WHICH list it wants and HOW to
 * fetch it.
 */

/** Stable identity for "no list yet" — a fresh `[]` per render would defeat every
 *  downstream `useMemo` / decoration-rebuild guard. */
const EMPTY: readonly never[] = []

export interface SeededLiveList<T> {
  /** The winning list: live when it is fresher than the seed, else the seed. */
  list: T[]
  /** Re-fetch the seed (call after an action the server will not stream back). */
  reload: () => void
}

/**
 * A settled fetch, plus the live list that was current at the moment it settled.
 *
 * That snapshot IS the freshness comparison: the live channel is fresher than this seed
 * exactly when `live` is no longer the value captured here — i.e. an event has replaced it
 * since the fetch came back. Identity, not a clock, because the two sources are compared on
 * "did something arrive after this?", which is an ordering question, not a duration one.
 */
interface Seed<T> {
  sid: string
  list: T[]
  /** `live` as of this fetch's settle — see {@link Seed}. */
  liveWhenFetched: T[] | undefined
}

/**
 * @param sessionId  the session the list belongs to; null ⇒ empty, no fetch.
 * @param live       the list patched onto the session by the stream, if any.
 * @param fetchList  one-shot loader. MUST be stable (define it at module scope) —
 *                   it is the effect's dependency, so an inline lambda re-fetches
 *                   on every render.
 */
export function useSeededLiveList<T>(
  sessionId: string | null,
  live: T[] | undefined,
  fetchList: (sessionId: string) => Promise<T[]>,
): SeededLiveList<T> {
  const workItemVisible = useWorkItemVisible()
  // The seed is KEYED by the session it belongs to, so a session switch derives to
  // empty immediately — no setState-in-effect to clear it, and the previous
  // session's list never flashes while the new fetch is in flight.
  const [seed, setSeed] = useState<Seed<T> | null>(null)
  // Guards against a slow fetch for session A landing after the user switched to B.
  const reqId = useRef(0)

  // Read ONLY inside the async settle below, never during render, so the seed can record
  // which live list it superseded. Mirrored in an effect because writing a ref while
  // rendering is impure. If a fetch settles inside the sliver between a live event's render
  // and this effect's commit, the seed captures the PREVIOUS live list and the live one wins
  // — the safe direction: the newest event is never hidden behind a fetch that raced it.
  const liveRef = useRef(live)
  useEffect(() => {
    liveRef.current = live
  }, [live])

  const reload = useCallback(() => {
    if (!workItemVisible || !sessionId) return
    const id = ++reqId.current
    const settle = (list: T[]) => {
      if (id === reqId.current) setSeed({ sid: sessionId, list, liveWhenFetched: liveRef.current })
    }
    fetchList(sessionId)
      .then(settle)
      // A REJECTED fetch seeds NOTHING. It used to `settle([])`, which made a network blip
      // the newest — and therefore winning — statement about the list, blanking a populated
      // Review tab. Only a RESOLVED response is a fact about the list; an empty resolved list
      // is the server saying "nothing" and still clears, but a failure says only that we
      // failed to ask. Note the hook takes a `Promise<T[]>` and so CANNOT tell a 404 from a
      // dropped connection: if a caller ever wants "the resource is gone ⇒ empty", that is the
      // FETCHER's policy to express by resolving `[]`, not a status code this hook can read.
      .catch(() => {})
  }, [workItemVisible, sessionId, fetchList])

  useEffect(() => {
    if (!workItemVisible) {
      // Invalidate an older read that may settle after the body was parked.
      reqId.current++
      return
    }
    let disposed = false
    // A seed is idempotent for one session identity. Let Strict Mode discard its
    // probe effect before the REST read begins; the live effect starts in the
    // same frame and explicit reloads remain immediate.
    enqueueMicrotask(() => {
      if (!disposed) reload()
    })
    return () => {
      disposed = true
    }
  }, [workItemVisible, reload])

  const forThisSession = seed?.sid === sessionId ? seed : null
  // Freshness is DERIVED, not stamped: the live list wins when no seed covers this session
  // yet, or when an event has replaced the list the seed saw. Deriving it (rather than
  // recording `Date.now()` from an effect) costs the live channel no extra render, lands the
  // winning list in the commit that carried the event, and cannot tie on the clock's
  // millisecond resolution when a fast fetch settles in the same tick as an event.
  const liveIsFresher =
    Boolean(live) && (!forThisSession || live !== forThisSession.liveWhenFetched)
  const list = liveIsFresher ? (live as T[]) : ((forThisSession?.list ?? EMPTY) as T[])
  return { list, reload }
}
