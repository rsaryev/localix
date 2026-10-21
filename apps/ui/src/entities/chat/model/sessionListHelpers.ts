import type { UiSession } from '@/shared/api/contracts'
import { applyStreamEventToSession } from '@/shared/api/client'
import type { ChatStore } from './store'
import { sessionBelongsToScope, sortSessions } from './sessionRosterPolicy'

export {
  sessionBelongsToScope,
  isEmptyDraftSession,
  pruneFinishedSubSessions,
  compareSessions,
  sortSessions,
} from './sessionRosterPolicy'

// Membership/order are stable across token deltas. Reuse the id→index table for
// each structurally-shared roster so the hot mirror performs one native array
// copy plus direct writes, not Map(next.sessions) + callback/map over every
// root/sub-session on every token.
const allSessionIndexCache = new WeakMap<readonly UiSession[], ReadonlyMap<string, number>>()

// Message deltas only change a session body. Keep their latest value out of the
// roster arrays so one token does not copy every session or invalidate the
// sidebar. A tiny revision patch still makes Zustand's id-scoped selectors run.
const liveSessionBodies = new Map<string, UiSession>()

export function getLiveSessionBody(sessionId: string): UiSession | undefined {
  return liveSessionBodies.get(sessionId)
}

export function clearLiveSessionBodies(): void {
  liveSessionBodies.clear()
}

export function clearLiveSessionBody(sessionId: string): void {
  liveSessionBodies.delete(sessionId)
}

function allSessionIndices(sessions: readonly UiSession[]): ReadonlyMap<string, number> {
  const cached = allSessionIndexCache.get(sessions)
  if (cached) return cached
  const indices = new Map<string, number>()
  for (let index = 0; index < sessions.length; index += 1) {
    indices.set(sessions[index]!.id, index)
  }
  allSessionIndexCache.set(sessions, indices)
  return indices
}

// Reconcile `allSessions` (the full roster) with `sessions` (the active-project
// view), and route body updates without changing unrelated list identities.
// The ChatStore import is type-only (erased) — no runtime cycle.

/**
 * Merge a state update into the session lists: reconcile `next.sessions` (the
 * active-project view) back into `allSessions` (the full set), then re-derive
 * the filtered+sorted `sessions` for the current project. Pure: returns the
 * partial to apply. Mirrors the previous inline customSet logic exactly,
 * including the fast path for content-only stream updates.
 */
export function mergeSessionState(state: ChatStore, next: Partial<ChatStore>): Partial<ChatStore> {
  const activeProjectId =
    next.activeProjectId !== undefined ? next.activeProjectId : state.activeProjectId

  let allSessions = state.allSessions || []
  if (next.allSessions !== undefined) {
    allSessions = next.allSessions
  } else if (next.sessions !== undefined) {
    // Fast path: a stream-token update replaces session CONTENT but never the
    // membership or order (it was already sorted+filtered upstream). Detect that
    // and just mirror the changed objects into allSessions by id — skipping the
    // Set allocations and the second sortSessions pass we'd otherwise pay per token.
    const prev = state.sessions || []
    if (next.activeProjectId === undefined && next.sessions.length === prev.length) {
      let sameOrder = true
      const changed: UiSession[] = []
      for (let i = 0; i < next.sessions.length; i++) {
        if (
          next.sessions[i].id !== prev[i].id ||
          !sessionBelongsToScope(next.sessions[i], activeProjectId)
        ) {
          sameOrder = false
          break
        }
        if (next.sessions[i] !== prev[i]) changed.push(next.sessions[i])
      }
      if (sameOrder) {
        if (changed.length === 0) {
          return { ...next, allSessions, sessions: next.sessions, activeProjectId }
        }
        const indices = allSessionIndices(allSessions)
        let mirroredAll = allSessions
        for (const session of changed) {
          const index = indices.get(session.id)
          if (index === undefined) {
            sameOrder = false
            break
          }
          if (mirroredAll === allSessions) mirroredAll = allSessions.slice()
          mirroredAll[index] = session
        }
        if (!sameOrder) {
          // An inconsistent working list falls through to the structural merge,
          // which also handles additions/deletions safely.
        } else {
          allSessionIndexCache.set(mirroredAll, indices)
          return { ...next, allSessions: mirroredAll, sessions: next.sessions, activeProjectId }
        }
      }
    }
    const sessionsMap = new Map(next.sessions.map((s) => [s.id, s]))
    const nextSessionIds = new Set(next.sessions.map((s) => s.id))
    const currentFilteredSessions = state.sessions || []
    const deletedSessionIds = new Set<string>()
    for (const s of currentFilteredSessions) {
      if (!nextSessionIds.has(s.id)) {
        deletedSessionIds.add(s.id)
      }
    }
    // "New to allSessions", NOT "new to the working list". This used to compare against
    // the FILTERED `sessions`, so any chat outside the active project (or a sub-session)
    // looked new here — while the map below had ALREADY replaced its live copy, leaving
    // allSessions holding the same id twice. `_replaceSession` prepends exactly such a
    // session whenever it is asked to refresh one the working list doesn't carry, and
    // the HITL inbox recovers them by design ("the waiting session may be in another
    // project"). The duplicate then surfaced as two identical rows — and a duplicate
    // React key — the moment the user navigated to that project.
    const allSessionIds = new Set(allSessions.map((s) => s.id))
    const addedSessions: UiSession[] = []
    for (const s of next.sessions) {
      if (!allSessionIds.has(s.id)) {
        addedSessions.push(s)
      }
    }

    let updatedAllSessions = allSessions.flatMap((s) =>
      deletedSessionIds.has(s.id) ? [] : [sessionsMap.get(s.id) ?? s],
    )

    if (addedSessions.length > 0) {
      updatedAllSessions = [...addedSessions, ...updatedAllSessions]
    }
    allSessions = updatedAllSessions
  }

  // Identity preservation: every store write funnels through here (customSet
  // overrides api.setState), so an unconditional `filter()` would hand every
  // subscriber of `sessions` a NEW array reference on every commit — including
  // ones that never touched the session lists (connections, message queue,
  // HITL inbox) and no-op stream ticks. Subscribers memoize on the array's
  // identity (useShallow can't see through a fresh ref), so keeping the old
  // reference when nothing changed is what stops a token in one session from
  // re-rendering every mounted surface.
  if (allSessions === state.allSessions && activeProjectId === state.activeProjectId) {
    return { ...next, allSessions, sessions: state.sessions, activeProjectId }
  }

  const filteredSessions = sortSessions(
    allSessions.filter((session) => sessionBelongsToScope(session, activeProjectId)),
  )

  return { ...next, allSessions, sessions: filteredSessions, activeProjectId }
}

/**
 * Patch ONE session wherever it actually lives — the generalisation of
 * {@link applyStreamEventPatch}'s routing, for the per-session writers that are not the
 * streaming hot path (flags, notices, resolved interactions).
 *
 * `sessions` is `allSessions` FILTERED by the active project, and the mirror in
 * {@link mergeSessionState} only refreshes sessions already present in `sessions`. So a
 * writer that maps over `state.sessions` alone is a silent no-op for a sub-session
 * (worker/reviewer/thread — only ever in `allSessions`) or a chat in another project,
 * while readers resolve by id out of `allSessions` (see {@link findSessionInState}).
 * That is the exact shape of the diagnostics regression this module already documents.
 */
export function patchSessionById(
  state: Pick<ChatStore, 'sessions' | 'allSessions'>,
  sessionId: string,
  patch: (session: UiSession) => UiSession,
): Partial<ChatStore> {
  const live = liveSessionBodies.get(sessionId)
  const inWorkingList = state.sessions.findIndex((s) => s.id === sessionId)
  if (inWorkingList !== -1) {
    const current = state.sessions[inWorkingList]!
    const patched = patch(live ?? current)
    if (patched === current && !live) return {}
    const sessions = state.sessions.slice()
    sessions[inWorkingList] = patched
    liveSessionBodies.delete(sessionId)
    return { sessions }
  }
  const inAll = state.allSessions.findIndex((s) => s.id === sessionId)
  if (inAll === -1) return {}
  const current = state.allSessions[inAll]!
  const patched = patch(live ?? current)
  if (patched === current && !live) return {}
  const allSessions = state.allSessions.slice()
  allSessions[inAll] = patched
  liveSessionBodies.delete(sessionId)
  return { allSessions }
}

/**
 * Apply a per-session stream event (message deltas, `lsp.diagnostics`, loop
 * updates …) to the session it targets, WHEREVER that session lives, returning
 * the store patch. Three cases:
 *
 * - A `message.delta` is kept in the O(1) live-body cache. Neither roster array
 *   changes, so unrelated surfaces/sidebar subscribers do not re-render per token.
 *   The next non-delta event commits that accumulated body into the canonical arrays.
 * - Other events targeting the active-project WORKING list (`sessions`) update it
 *   there and let {@link mergeSessionState} mirror the new object into `allSessions`.
 * - Target is OUTSIDE the working view — a sub-session (worker/reviewer/thread,
 *   which is ONLY ever in `allSessions`) or a session in another project. The
 *   `sessions`→`allSessions` mirror never reaches it, yet readers key off
 *   `allSessions` BY SESSION ID (FileTab live diagnostics, the Problems tab, the
 *   editor-grid problems badge). Update it directly in `allSessions` so those
 *   readers actually see the event instead of a silently-dropped update.
 *
 * The prior reducer only ever mapped over `sessions`, so diagnostics (and every
 * other per-session event) for a non-working-list session were dropped — the
 * "LSP squiggles stopped showing" regression once FileTab began reading its OWN
 * (possibly non-active, possibly sub-) session rather than the active one.
 */
export function applyStreamEventPatch(
  state: Pick<ChatStore, 'sessions' | 'allSessions'> & { _liveSessionRevision?: number },
  sessionId: string,
  event: Parameters<typeof applyStreamEventToSession>[1],
): Partial<ChatStore> {
  // No-op events (a delta for a message not in the store yet, an event the
  // reducer returns the session unchanged for) must not mint new list
  // identities — that alone re-renders every list subscriber. Patch the one
  // session in place and reuse the array only when it actually changed.
  const inWorkingList = state.sessions.findIndex((s) => s.id === sessionId)
  const inAll = inWorkingList === -1 ? state.allSessions.findIndex((s) => s.id === sessionId) : -1
  const stored =
    inWorkingList !== -1
      ? state.sessions[inWorkingList]
      : inAll !== -1
        ? state.allSessions[inAll]
        : undefined
  const prev = liveSessionBodies.get(sessionId) ?? stored
  if (!prev) return {}
  const patched = applyStreamEventToSession(prev, event)
  if (patched === prev) return {}

  if (event.type === 'message.delta') {
    liveSessionBodies.set(sessionId, patched)
    return { _liveSessionRevision: (state._liveSessionRevision ?? 0) + 1 }
  }

  const hadLiveBody = liveSessionBodies.delete(sessionId)
  const revisionPatch = hadLiveBody
    ? { _liveSessionRevision: (state._liveSessionRevision ?? 0) + 1 }
    : {}
  if (inWorkingList !== -1) {
    const next = state.sessions.slice()
    next[inWorkingList] = patched
    return { sessions: sortSessions(next), ...revisionPatch }
  }
  const next = state.allSessions.slice()
  next[inAll] = patched
  return { allSessions: next, ...revisionPatch }
}
