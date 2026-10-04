import { useCallback, useSyncExternalStore } from 'react'

/**
 * Per-session RUNTIME TICKS, held OUTSIDE the zustand store.
 *
 * `child_session.activity` is the highest-frequency frame the chat store sees: the backend
 * publishes it on every tool start, every tool end, and every streamed output chunk, for every
 * running sub-agent. It used to be reduced into `UiSession.runtime*` inside `allSessions`, which
 * meant one tick minted a brand-new roster array — and a session that had spawned 782 concurrent
 * sub-agents therefore rebuilt a 780-element array thousands of times a second while the sidebar,
 * the breadcrumb, the session switcher and the runtime panel each re-derived Maps and filters over
 * it. The tab (and the machine) froze.
 *
 * The fix is structural, not a memo: a "doing now" label is NOT roster state, so it does not live
 * in the roster. `allSessions` is a roster only; the hot per-id values live here, keyed by session
 * id, and a row subscribes to its OWN id. A tick then re-renders exactly the one row that shows it
 * and touches no array identity anywhere.
 *
 * Same idiom as the two external stores this codebase already runs on: the hot-body cache in
 * `sessionListHelpers.ts` (`liveSessionBodies`) and the subscribe/version contribution stores in
 * `shared/contrib/` (`runtimeViews.ts`).
 */

export interface SessionActivity {
  /** Compact "doing now" line for a running sub-agent / job. */
  activity?: string
  /** The child run's current turn number. */
  turnCount?: number
  /** The child run's cumulative tool-execution count. */
  toolCount?: number
}

/**
 * Shared empty snapshot. `useSyncExternalStore` compares `getSnapshot()` results by identity and
 * re-renders (then, unchanged, throws "getSnapshot should be cached") when they differ, so the
 * absent case MUST be one frozen object rather than a fresh `{}` per read.
 */
const EMPTY_ACTIVITY: SessionActivity = Object.freeze({})

const activityBySession = new Map<string, SessionActivity>()
const listenersBySession = new Map<string, Set<() => void>>()

// AGGREGATE subscribers (see subscribeAllSessionActivity) are notified on a coalescing timer
// rather than per tick: unlike a row, an aggregate consumer rebuilds an O(sessions) structure per
// notification, so a per-tick signal reintroduces exactly the cost this module exists to remove.
const AGGREGATE_NOTIFY_MS = 100
const aggregateListeners = new Set<() => void>()
let aggregateVersion = 0
let aggregateTimer: ReturnType<typeof setTimeout> | null = null

function notifyAggregate(): void {
  if (aggregateListeners.size === 0 || aggregateTimer !== null) return
  aggregateTimer = setTimeout(() => {
    aggregateTimer = null
    aggregateVersion += 1
    for (const listener of aggregateListeners) listener()
  }, AGGREGATE_NOTIFY_MS)
}

/** The latest tick for `sessionId` — a STABLE reference while the values are unchanged. */
export function getSessionActivity(sessionId: string | null | undefined): SessionActivity {
  if (!sessionId) return EMPTY_ACTIVITY
  return activityBySession.get(sessionId) ?? EMPTY_ACTIVITY
}

/** Subscribe to ONE session's ticks. Per-id by design: a whole-map listener re-renders everything. */
export function subscribeSessionActivity(sessionId: string, listener: () => void): () => void {
  const listeners = listenersBySession.get(sessionId) ?? new Set<() => void>()
  listeners.add(listener)
  listenersBySession.set(sessionId, listeners)
  return () => {
    const current = listenersBySession.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listenersBySession.delete(sessionId)
  }
}

/**
 * Apply one `child_session.activity` frame. A no-op when nothing changed, so the row's snapshot
 * keeps its identity and React skips the render entirely.
 */
export function applySessionActivity(sessionId: string, next: SessionActivity): void {
  const current = activityBySession.get(sessionId)
  if (
    current &&
    current.activity === next.activity &&
    current.turnCount === next.turnCount &&
    current.toolCount === next.toolCount
  ) {
    return
  }
  activityBySession.set(sessionId, next)
  const listeners = listenersBySession.get(sessionId)
  if (listeners) for (const listener of listeners) listener()
  notifyAggregate()
}

export function clearSessionActivity(sessionId: string): void {
  if (!activityBySession.delete(sessionId)) return
  const listeners = listenersBySession.get(sessionId)
  if (listeners) for (const listener of listeners) listener()
  notifyAggregate()
}

/**
 * Drop ticks for sessions the roster no longer carries — this map's only owner is the roster it
 * decorates, and nothing else would ever release an entry (a delegated run's row is evicted by
 * `pruneFinishedSubSessions`, and its label would otherwise outlive the tab).
 *
 * Only sweeps when the map is BIGGER than the roster, i.e. when it definitely holds strays. A tick
 * can legitimately arrive just before the `child_session.updated` that adds its row, and evicting
 * that on an unrelated roster write would blank a live label for one window.
 */
export function retainSessionActivity(roster: readonly { id: string }[]): void {
  if (activityBySession.size <= roster.length) return
  const keep = new Set<string>()
  for (const session of roster) keep.add(session.id)
  // Deleting during iteration is safe by spec — a Map iterator skips entries removed
  // before it reaches them — so the defensive copy of every key is pure allocation.
  for (const sessionId of activityBySession.keys()) {
    if (!keep.has(sessionId)) clearSessionActivity(sessionId)
  }
}

/**
 * Subscribe to "SOME session ticked", coalesced to at most one notification per
 * {@link AGGREGATE_NOTIFY_MS}. For a consumer that rebuilds a whole tree/scene from every session
 * at once (a batch activity publisher) and so cannot use the per-id path. A row must NOT use
 * this — it would re-render on another session's tick.
 */
export function subscribeAllSessionActivity(listener: () => void): () => void {
  aggregateListeners.add(listener)
  return () => {
    aggregateListeners.delete(listener)
  }
}

/** Monotonic snapshot id for the aggregate `useSyncExternalStore`. */
export function allSessionActivityVersion(): number {
  return aggregateVersion
}

/** One session's live ticks, subscribed BY ID from inside the row that renders it. */
export function useSessionActivity(sessionId: string | null | undefined): SessionActivity {
  const subscribe = useCallback(
    (listener: () => void) =>
      sessionId ? subscribeSessionActivity(sessionId, listener) : () => {},
    [sessionId],
  )
  const snapshot = useCallback(() => getSessionActivity(sessionId), [sessionId])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
