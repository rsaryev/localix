import { randomUUID } from 'node:crypto'

import { createPriorityQueue, type PriorityQueue } from '../../../../lib/priority-queue'
import type { RuntimeState } from '../agent-runner-state'
import type { RunCompletion } from '../run-outcome'
import type { DurableQueueItem, WakeQueueStore } from '../wake-queue-store'
import { readPendingTurn, type PendingTurn } from './entry'

/**
 * WHO HOLDS AN ENTRY: a drain delivering it, or a running turn taking it at a boundary. One holder
 * per entry, kept beside the durable lease (`claim`): an entry anyone holds is not removed,
 * reprioritised, folded into, or offered to anyone else.
 */
export type LeaseHolder = 'drain' | 'steer'

export function holdLeases(
  shared: Pick<WakeQueueSharedState, 'leases'>,
  sessionId: string,
  ids: readonly string[],
  holder: LeaseHolder,
): void {
  const held = shared.leases.get(sessionId) ?? new Map<string, LeaseHolder>()
  for (const id of ids) held.set(id, holder)
  shared.leases.set(sessionId, held)
}

/** Let go of `ids` — only those `holder` holds, when one is named. */
export function dropLeases(
  shared: Pick<WakeQueueSharedState, 'leases'>,
  sessionId: string,
  ids: readonly string[],
  holder?: LeaseHolder,
): void {
  const held = shared.leases.get(sessionId)
  if (!held) return
  for (const id of ids) if (!holder || held.get(id) === holder) held.delete(id)
  if (held.size === 0) shared.leases.delete(sessionId)
}

export const leaseHolder = (
  shared: Pick<WakeQueueSharedState, 'leases'>,
  sessionId: string,
  id: string,
): LeaseHolder | undefined => shared.leases.get(sessionId)?.get(id)

export interface WakeQueueSharedState {
  activeRuns: RuntimeState['activeRuns']
  drainingSessions: RuntimeState['drainingSessions']
  queues: Map<string, PriorityQueue<PendingTurn>>
  /** Session → entry → who holds its in-process lease (`holdLeases`). */
  leases: Map<string, Map<string, LeaseHolder>>
  /** One promotion may borrow the running drain while its durable claim is pending. */
  promotingSessions: Set<string>
  /** A selected send-now row handed to a drain that is already running an agent ticket. */
  pendingPromotions: Map<string, string>
  recoveryTimers: Set<ReturnType<typeof setTimeout>>
  /** One per session: the moment its earliest held report is released by age (`holds.ts`). */
  holdTimers: Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>
  drainRetryTimers: Map<string, ReturnType<typeof setTimeout>>
  drainRetryAttempts: Map<string, number>
  inFlightDrains: Set<Promise<void>>
  continuationCompletions: Map<string, { sessionId: string; completions: Set<RunCompletion> }>
  closed: boolean
}

export const createWakeQueueSharedState = (
  state: Pick<RuntimeState, 'activeRuns' | 'drainingSessions'>,
): WakeQueueSharedState => ({
  activeRuns: state.activeRuns,
  drainingSessions: state.drainingSessions,
  // The manager OWNS the per-session queues (not RuntimeState) — keeping the
  // data structure beside the logic that maintains its invariants.
  queues: new Map<string, PriorityQueue<PendingTurn>>(),
  leases: new Map<string, Map<string, LeaseHolder>>(),
  promotingSessions: new Set<string>(),
  pendingPromotions: new Map<string, string>(),
  recoveryTimers: new Set<ReturnType<typeof setTimeout>>(),
  holdTimers: new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>(),
  drainRetryTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  drainRetryAttempts: new Map<string, number>(),
  inFlightDrains: new Set<Promise<void>>(),
  // A RunCompletion is process-local control state, never durable queue payload.
  // Keying it by delivery id lets a queued continuation inherit the logical run
  // without serializing Promises or coupling PendingTurn to one runtime engine.
  continuationCompletions: new Map<
    string,
    { sessionId: string; completions: Set<RunCompletion> }
  >(),
  closed: false,
})

interface LeaseDependencies {
  now: () => string
  store?: WakeQueueStore<PendingTurn>
  scheduleDrain: (sessionId: string) => void
}

export const createLeaseOperations = (
  shared: WakeQueueSharedState,
  { now, store, scheduleDrain }: LeaseDependencies,
) => {
  const leaseOwner = randomUUID()
  const LEASE_MS = 60_000

  const leaseWindow = (): { nowIso: string; expiresIso: string } => {
    const nowIso = now()
    const at = Date.parse(nowIso)
    return {
      nowIso,
      expiresIso: new Date((Number.isFinite(at) ? at : Date.now()) + LEASE_MS).toISOString(),
    }
  }

  const restore = (row: DurableQueueItem<unknown>): void => {
    let q = shared.queues.get(row.sessionId)
    if (!q) {
      q = createPriorityQueue<PendingTurn>()
      shared.queues.set(row.sessionId, q)
    }
    if (!q.list().some((item) => item.id === row.id)) {
      q.enqueue(readPendingTurn(row.payload, row.batchId), { id: row.id, priority: row.priority })
    }
    if (row.state === 'leased' && row.leaseExpiresAt) {
      const delay = Math.max(0, Date.parse(row.leaseExpiresAt) - Date.now()) + 5
      const timer = setTimeout(() => {
        shared.recoveryTimers.delete(timer)
        scheduleDrain(row.sessionId)
      }, delay)
      timer.unref?.()
      shared.recoveryTimers.add(timer)
    }
  }

  /** One startup barrier: expired leases are released before rows become visible.
   * Every public async mutation awaits it, so restart recovery cannot reorder a
   * concurrent enqueue ahead of an older persisted FIFO row. */
  const ready = store
    ? (async () => {
        let lastError: unknown
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (shared.closed) return
          try {
            await store.recoverExpired(now())
            for (const row of await store.listAll()) restore(row)
            return
          } catch (error) {
            lastError = error
            if (attempt < 2) {
              await new Promise<void>((resolve) => setTimeout(resolve, [25, 100][attempt]))
              if (shared.closed) return
            }
          }
        }
        throw lastError
      })()
    : Promise.resolve()

  /**
   * Lease `ids` as one delivery. Several are claimed as a BATCH, named by its first entry: the
   * name is written with the lease and kept until acknowledgement, so the band is a fact the
   * store holds rather than one the next selection re-derives (`entry.ts`, `batch`).
   */
  const claim = async (userId: string, sessionId: string, ids: readonly string[]) => {
    const batch = ids.length > 1 ? ids[0] : undefined
    if (store) {
      await ready
      const window = leaseWindow()
      const claimed = await store.claim(
        userId,
        sessionId,
        ids,
        leaseOwner,
        window.nowIso,
        window.expiresIso,
        batch,
      )
      if (!claimed) return false
    }
    if (batch) {
      const q = shared.queues.get(sessionId)
      for (const item of q?.list() ?? [])
        if (ids.includes(item.id)) q!.update(item.id, { ...item.value, batch })
    }
    return true
  }

  const ack = async (userId: string, sessionId: string, ids: readonly string[]) =>
    store ? store.ack(userId, sessionId, ids, leaseOwner) : true

  const release = async (userId: string, sessionId: string, ids: readonly string[]) => {
    if (store) await store.release(userId, sessionId, ids, leaseOwner)
  }

  const isLeased = (sessionId: string, itemId: string): boolean =>
    leaseHolder(shared, sessionId, itemId) !== undefined

  const releaseDrainBand = (sessionId: string, ids: readonly string[]): void =>
    dropLeases(shared, sessionId, ids, 'drain')

  const resetDrainRetry = (sessionId: string): void => {
    shared.drainRetryAttempts.delete(sessionId)
    const timer = shared.drainRetryTimers.get(sessionId)
    if (timer) clearTimeout(timer)
    shared.drainRetryTimers.delete(sessionId)
  }

  const scheduleDrainRetry = (sessionId: string): void => {
    if (shared.closed || shared.drainRetryTimers.has(sessionId)) return
    const attempt = shared.drainRetryAttempts.get(sessionId) ?? 0
    if (attempt >= 3) return
    shared.drainRetryAttempts.set(sessionId, attempt + 1)
    const timer = setTimeout(
      () => {
        shared.drainRetryTimers.delete(sessionId)
        scheduleDrain(sessionId)
      },
      [25, 100, 500][attempt] ?? 500,
    )
    timer.unref?.()
    shared.drainRetryTimers.set(sessionId, timer)
  }

  return {
    ready,
    claim,
    ack,
    release,
    isLeased,
    releaseDrainBand,
    resetDrainRetry,
    scheduleDrainRetry,
  }
}

export type LeaseOperations = ReturnType<typeof createLeaseOperations>
