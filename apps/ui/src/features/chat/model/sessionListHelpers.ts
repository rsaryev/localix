import type { UiSession } from '@/shared/api/contracts'
import { applyStreamEventToSession } from '@/shared/api/client'
import type { ChatStore } from './store'

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

/**
 * The single workspace-scope predicate.
 *
 * A scope IS a project — there is no project-less one. `null` therefore means the scope has
 * not resolved yet (the first frames of a cold launch), and nothing belongs to it; it is
 * never a wildcard for every project.
 */
export function sessionBelongsToScope(
  session: Pick<UiSession, 'projectId'>,
  activeProjectId: string | null,
): boolean {
  return activeProjectId !== null && session.projectId === activeProjectId
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

// Pure session-list logic for the chat store: empty-draft detection, sort order,
// and the session-membership merge that keeps `allSessions` (full set) and
// `sessions` (active-project view) consistent on every update. Extracted from
// store.ts so the store holds actions and this holds the list reducer. The
// ChatStore import is type-only (erased) — no runtime cycle.

/** Backend default title for a freshly created chat (see api service.ts). */
const DEFAULT_SESSION_TITLE = 'New Chat'

/**
 * An "empty draft": a root chat with no messages and the default/blank title —
 * i.e. a New Chat the user never used. We reuse these instead of spawning
 * duplicates so a project never accumulates a pile of empty "New Chat" rows.
 *
 * "No messages" is read from the PERSISTED count, not from `messages`. A list row
 * never carries a body, and switching away evicts the body of the chat you left
 * (`activateSessionBody` keeps only client notices), so `messages` is empty for
 * almost every chat that is not open. Reading it made each used chat whose title
 * was still "New Chat" look like a draft: New chat jumped to one, opening it
 * loaded its body, the next click jumped to the next one — several clicks landed
 * in several old chats before a real new one was made. A client notice (a model
 * change on an untouched draft) is not conversation, so it does not count.
 */
export function isEmptyDraftSession(s: UiSession): boolean {
  return (
    s.sessionKind !== 'subagent' &&
    s.sessionKind !== 'job' &&
    !s.parentSessionId &&
    !s.isRunning &&
    (s.messageCount ?? 0) === 0 &&
    !(s.messages ?? []).some((message) => message.role !== 'system') &&
    (!s.title?.trim() || s.title.trim() === DEFAULT_SESSION_TITLE)
  )
}

/**
 * A "sub-session" = an ephemeral run artifact attached to a chat: a delegated task
 * worker (`job`/`subagent`) or a task/message thread (`system` / `message-thread:`).
 * These stream in via `child_session.updated` and, unlike root chats, are not the
 * user's durable work — once finished they only ever accumulate in the client store.
 */
function isSubSession(s: UiSession): boolean {
  return (
    s.sessionKind === 'job' ||
    s.sessionKind === 'subagent' ||
    s.sessionKind === 'system' ||
    (s.sourceToolCallId?.startsWith('message-thread:') ?? false)
  )
}

/** Max FINISHED sub-sessions retained per host chat before the oldest are evicted. */
export const MAX_FINISHED_SUBSESSIONS_PER_HOST = 25

/**
 * Hard ceiling on sub-session rows retained OVERALL, across every host.
 *
 * The per-host rule below cannot bound anything on its own: it exempts every still-RUNNING
 * sub-session, and one `delegate` fan-out is enough to make that exemption unbounded — a session
 * once spawned 782 concurrent sub-agents and the roster held all of them, each a live row the
 * sidebar/breadcrumb/runtime-panel re-derived over. Two hundred is far above any roster a human
 * reads and far below the point where the derivations cost anything.
 */
export const MAX_RETAINED_SUBSESSIONS = 200

/**
 * Bound the unbounded growth of finished sub-sessions in `allSessions`. Every
 * delegated run / delegated task run / thread that ever ran stays in the client store
 * for the tab's lifetime (it's never removed on completion), so a long working
 * session piles up dozens of dead sub-session rows — each one live DOM + listeners
 * the GC can't reclaim, and extra entries the sidebar re-maps on every tick.
 *
 * Keeps: every root/fork chat, every still-RUNNING sub-session, and the most
 * recent {@link MAX_FINISHED_SUBSESSIONS_PER_HOST} FINISHED sub-sessions per host
 * (by `updatedAt`) — then, as a backstop the per-host rule cannot provide, at most
 * {@link MAX_RETAINED_SUBSESSIONS} sub-session rows in total. Returns the same array reference
 * when nothing is evicted, so subscribers aren't handed a needlessly new identity.
 */
export function pruneFinishedSubSessions(
  allSessions: UiSession[],
  cap = MAX_FINISHED_SUBSESSIONS_PER_HOST,
  overallCap = MAX_RETAINED_SUBSESSIONS,
): UiSession[] {
  const finishedByHost = new Map<string, UiSession[]>()
  const subSessions: UiSession[] = []
  for (const s of allSessions) {
    if (!isSubSession(s)) continue
    subSessions.push(s)
    if (s.isRunning) continue
    const host = s.parentSessionId ?? s.rootSessionId ?? '∅'
    const list = finishedByHost.get(host)
    if (list) list.push(s)
    else finishedByHost.set(host, [s])
  }

  const evict = new Set<string>()
  for (const list of finishedByHost.values()) {
    if (list.length <= cap) continue
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    for (let i = cap; i < list.length; i++) evict.add(list[i].id)
  }

  // Overall backstop, applied to whatever the per-host pass kept. Running rows are NOT exempt here
  // — they are precisely what overflows this cap — so eviction is purely most-recently-updated
  // wins. A row dropped while its run is still live is re-added by its next `child_session.updated`
  // (the store upserts on that event), so this degrades the tail of an absurd roster rather than
  // losing a session.
  const retained = evict.size === 0 ? subSessions : subSessions.filter((s) => !evict.has(s.id))
  if (retained.length > overallCap) {
    const byRecency = [...retained].sort((a, b) => b.updatedAt - a.updatedAt)
    for (let i = overallCap; i < byRecency.length; i++) evict.add(byRecency[i].id)
  }

  if (evict.size === 0) return allSessions
  return allSessions.filter((s) => !evict.has(s.id))
}

export function compareSessions(a: UiSession, b: UiSession): number {
  if (a.isPinned !== b.isPinned) return Number(b.isPinned) - Number(a.isPinned)
  return b.updatedAt - a.updatedAt
}

export function sortSessions(sessions: UiSession[]): UiSession[] {
  // Fast path: stream events fire many times per second but rarely reorder the
  // list. If the array is already ordered, return it as-is to skip the spread +
  // sort allocation (and avoid handing subscribers a needlessly new reference).
  for (let i = 1; i < sessions.length; i++) {
    if (compareSessions(sessions[i - 1], sessions[i]) > 0) {
      return [...sessions].sort(compareSessions)
    }
  }
  return sessions
}

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
        if (next.sessions[i].id !== prev[i].id) {
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
 * Apply a per-session stream event (message deltas, `lsp.diagnostics`, loop
 * updates …) to the session it targets, WHEREVER that session lives, returning
 * the store patch. Two cases:
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
