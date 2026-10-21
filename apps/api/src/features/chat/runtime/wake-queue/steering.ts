import type { QueueItem } from '../../../../lib/priority-queue'
import type { SessionQueueItem, WakeSource } from '../../contracts'
import type { WakeQueueStore } from '../wake-queue-store'
import type { PendingTurn } from './entry'
import type { HeldEntries } from './holds'
import { renderBatch } from './kinds'
import { dropLeases, holdLeases, type LeaseOperations, type WakeQueueSharedState } from './leases'
import { createSteerableSelection, type JoinFilter } from './steerable'

export type { JoinFilter, SubagentSteeringAddress } from './steerable'

/** What a running turn took: one delivery, however many queued entries it stands for. */
export interface SteeringReservation {
  /** The reservation's id — its first entry's — which acknowledges or releases all of them. */
  id: string
  userId: string
  content: string
  queuedAt: string
  source?: WakeSource
  internal: boolean
  clientMessageIds?: string[]
}

interface SteeringDependencies {
  store?: WakeQueueStore<PendingTurn>
  ready: Promise<void>
  leases: LeaseOperations
  publishQueue: (userId: string, sessionId: string) => void
  toPublic: (item: QueueItem<PendingTurn>, held: HeldEntries) => SessionQueueItem
  /** What may not open a turn yet (`holds.ts`): listed as held, and not "waiting to be heard". */
  holdsOf: (sessionId: string) => HeldEntries
}

export const createSteeringOperations = (
  shared: WakeQueueSharedState,
  { store, ready, leases, publishQueue, toPublic, holdsOf }: SteeringDependencies,
) => {
  const { claim, ack, release } = leases
  const { nextJoinable, peekSteerable } = createSteerableSelection(shared)
  /** Reservation id → the entries it took, per session. */
  const reservations = new Map<string, Map<string, string[]>>()
  const reservedIds = (sessionId: string, id: string) =>
    reservations.get(sessionId)?.get(id) ?? [id]

  const unlease = (sessionId: string, ids: readonly string[]) =>
    dropLeases(shared, sessionId, ids, 'steer')
  /** Reservation → its lease renewal (`keepAlive`), stopped on acknowledgement or release. */
  const renewals = new Map<string, () => void>()
  const forget = (sessionId: string, id: string) => {
    const key = `${sessionId}\u0000${id}`
    renewals.get(key)?.()
    renewals.delete(key)
    const held = reservations.get(sessionId)
    held?.delete(id)
    if (held?.size === 0) reservations.delete(sessionId)
  }

  /** Reserve what this run may take next without removing it. The caller acknowledges only
   * after committing its transcript row. */
  const reserveLocal = (sessionId: string, filter: JoinFilter): SteeringReservation[] => {
    const band = nextJoinable(sessionId, filter)
    if (!band?.length) return []
    const ids = band.map((item) => item.id)
    holdLeases(shared, sessionId, ids, 'steer')
    const head = band[0]!.value
    if (ids.length > 1) {
      const held = reservations.get(sessionId) ?? new Map<string, string[]>()
      held.set(ids[0]!, ids)
      reservations.set(sessionId, held)
    }
    const clientMessageIds = band.flatMap((item) =>
      item.value.clientMessageId ? [item.value.clientMessageId] : [],
    )
    return [
      {
        id: ids[0]!,
        userId: head.userId,
        content: renderBatch(band.map((item) => item.value)),
        queuedAt: head.queuedAt,
        internal: head.internal,
        ...(head.source ? { source: head.source } : {}),
        ...(clientMessageIds.length ? { clientMessageIds } : {}),
      },
    ]
  }

  const reserveSteerable = (
    sessionId: string,
    filter: JoinFilter = {},
  ): SteeringReservation[] | Promise<SteeringReservation[]> => {
    if (!store) return reserveLocal(sessionId, filter)
    return (async () => {
      await ready
      const candidate = reserveLocal(sessionId, filter)
      const first = candidate[0]
      if (!first) return []
      const ids = reservedIds(sessionId, first.id)
      if (await claim(first.userId, sessionId, ids)) {
        // The run holds it until its transcript write commits, which may outlast one lease.
        renewals.set(
          `${sessionId}\u0000${first.id}`,
          leases.keepAlive(first.userId, sessionId, ids),
        )
        return candidate
      }
      unlease(sessionId, ids)
      forget(sessionId, first.id)
      return []
    })()
  }

  const releaseSteerable = (sessionId: string, reservationId: string): void | Promise<void> => {
    const ids = reservedIds(sessionId, reservationId)
    const item = shared.queues
      .get(sessionId)
      ?.list()
      .find((candidate) => candidate.id === reservationId)
    unlease(sessionId, ids)
    forget(sessionId, reservationId)
    if (store && item) return release(item.value.userId, sessionId, ids)
  }

  const ackSteerableLocal = (userId: string, sessionId: string, ids: readonly string[]) => {
    const q = shared.queues.get(sessionId)
    const removed = ids.map((id) => q?.remove(id) ?? false).every(Boolean)
    unlease(sessionId, ids)
    forget(sessionId, ids[0]!)
    if (removed) publishQueue(userId, sessionId)
    return removed
  }

  const ackSteerable = (
    userId: string,
    sessionId: string,
    reservationId: string,
  ): boolean | Promise<boolean> => {
    const ids = reservedIds(sessionId, reservationId)
    if (!store) return ackSteerableLocal(userId, sessionId, ids)
    return ack(userId, sessionId, ids).then((owned) =>
      owned ? ackSteerableLocal(userId, sessionId, ids) : false,
    )
  }

  /** Public snapshot for session list/detail hydration. */
  const listLocal = (sessionId: string): SessionQueueItem[] => {
    const q = shared.queues.get(sessionId)
    if (!q) return []
    const held = holdsOf(sessionId)
    return q.list().map((item) => toPublic(item, held))
  }

  const list = (sessionId: string): SessionQueueItem[] | Promise<SessionQueueItem[]> =>
    store ? ready.then(() => listLocal(sessionId)) : listLocal(sessionId)

  /** Is anything waiting that would open a turn? A held report is not: it waits for siblings. */
  const hasPendingLocal = (sessionId: string): boolean => {
    const q = shared.queues.get(sessionId)
    if (!q || q.size() === 0) return false
    const held = holdsOf(sessionId)
    // A failed entry waits for the person, not for a turn (`dead-letter.ts`).
    return q.list().some((item) => !held.ids.has(item.id) && !item.value.failure)
  }
  const hasPending = (sessionId: string): boolean | Promise<boolean> =>
    store ? ready.then(() => hasPendingLocal(sessionId)) : hasPendingLocal(sessionId)

  return {
    reserveSteerable,
    peekSteerable,
    releaseSteerable,
    ackSteerable,
    list,
    hasPending,
  }
}
