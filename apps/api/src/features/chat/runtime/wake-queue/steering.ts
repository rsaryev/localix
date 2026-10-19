import type { QueueItem } from '../../../../lib/priority-queue'
import type {
  QueueClearResult,
  QueueRemovalResult,
  SessionQueueItem,
  WakeSource,
} from '../../contracts'
import type { WakeQueueStore } from '../wake-queue-store'
import type { ContinuationOperations } from './continuations'
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
  continuations: ContinuationOperations
  publishQueue: (userId: string, sessionId: string) => void
  toPublic: (item: QueueItem<PendingTurn>, held: HeldEntries) => SessionQueueItem
  /** What may not open a turn yet (`holds.ts`): listed as held, and not "waiting to be heard". */
  holdsOf: (sessionId: string) => HeldEntries
}

export const createSteeringOperations = (
  shared: WakeQueueSharedState,
  { store, ready, leases, continuations, publishQueue, toPublic, holdsOf }: SteeringDependencies,
) => {
  const { claim, ack, release, isLeased } = leases
  const { settleCompletion } = continuations
  const { nextJoinable, peekSteerable } = createSteerableSelection(shared)
  /** Reservation id → the entries it took, per session. */
  const reservations = new Map<string, Map<string, string[]>>()
  const reservedIds = (sessionId: string, id: string) =>
    reservations.get(sessionId)?.get(id) ?? [id]

  const unlease = (sessionId: string, ids: readonly string[]) =>
    dropLeases(shared, sessionId, ids, 'steer')
  const forget = (sessionId: string, id: string) => {
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
      if (await claim(first.userId, sessionId, ids)) return candidate
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

  /** Remove a queued item by id and return its full content for composer restoration. */
  const removeLocal = (userId: string, sessionId: string, itemId: string): QueueRemovalResult => {
    const q = shared.queues.get(sessionId)
    if (!q) return { removed: false, reason: 'not_found' }
    // Once steering persistence starts, cancellation would race a durable row that
    // may already have committed. The chip disappears on acknowledgement instead.
    if (isLeased(sessionId, itemId)) return { removed: false, reason: 'leased' }
    const item = q.list().find((candidate) => candidate.id === itemId)
    if (!item) return { removed: false, reason: 'not_found' }
    // A band once claimed is being delivered as a whole; taking one entry out would change a
    // delivery its transcript row may already hold.
    if (item.value.batch) return { removed: false, reason: 'leased' }
    if (!q.remove(itemId)) return { removed: false, reason: 'not_found' }
    settleCompletion([itemId], {
      status: 'failed',
      kind: 'dismissed',
      message: 'Queued run was cancelled before execution.',
      retryable: false,
      rateLimited: false,
    })
    publishQueue(userId, sessionId)
    return {
      removed: true,
      content: item.value.content,
      ...(item.value.bindings?.length ? { bindings: item.value.bindings } : {}),
    }
  }

  const remove = (
    userId: string,
    sessionId: string,
    itemId: string,
  ): QueueRemovalResult | Promise<QueueRemovalResult> => {
    if (!store) return removeLocal(userId, sessionId, itemId)
    return (async () => {
      await ready
      const q = shared.queues.get(sessionId)
      if (!q) return { removed: false, reason: 'not_found' }
      if (isLeased(sessionId, itemId)) return { removed: false, reason: 'leased' }
      const item = q.list().find((candidate) => candidate.id === itemId)
      if (!item) return { removed: false, reason: 'not_found' }
      if (item.value.batch) return { removed: false, reason: 'leased' }
      if (!(await store.remove(userId, sessionId, itemId))) {
        return { removed: false, reason: 'leased' }
      }
      return removeLocal(userId, sessionId, itemId)
    })()
  }

  /** Clear every cancellable item; leased steering rows remain visible and are reported. */
  const clearLocal = (userId: string, sessionId: string): QueueClearResult => {
    const q = shared.queues.get(sessionId)
    if (!q) return { removed: 0, retained: [] }
    let removed = 0
    const retained: string[] = []
    for (const item of q.list()) {
      if (isLeased(sessionId, item.id) || item.value.batch) retained.push(item.id)
      else if (q.remove(item.id)) {
        settleCompletion([item.id], {
          status: 'failed',
          kind: 'dismissed',
          message: 'Queued run was cleared before execution.',
          retryable: false,
          rateLimited: false,
        })
        removed += 1
      }
    }
    if (removed > 0) publishQueue(userId, sessionId)
    return { removed, retained }
  }

  const clear = (
    userId: string,
    sessionId: string,
  ): QueueClearResult | Promise<QueueClearResult> => {
    if (!store) return clearLocal(userId, sessionId)
    return (async () => {
      await ready
      const q = shared.queues.get(sessionId)
      if (!q) return { removed: 0, retained: [] }
      let removed = 0
      const retained: string[] = []
      for (const item of q.list()) {
        if (isLeased(sessionId, item.id) || item.value.batch) retained.push(item.id)
        else if (await store.remove(userId, sessionId, item.id)) {
          if (q.remove(item.id)) {
            settleCompletion([item.id], {
              status: 'failed',
              kind: 'dismissed',
              message: 'Queued run was cleared before execution.',
              retryable: false,
              rateLimited: false,
            })
            removed += 1
          }
        } else retained.push(item.id)
      }
      if (removed > 0) publishQueue(userId, sessionId)
      return { removed, retained }
    })()
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
    return q.list().some((item) => !held.ids.has(item.id))
  }
  const hasPending = (sessionId: string): boolean | Promise<boolean> =>
    store ? ready.then(() => hasPendingLocal(sessionId)) : hasPendingLocal(sessionId)

  return {
    reserveSteerable,
    peekSteerable,
    releaseSteerable,
    ackSteerable,
    remove,
    clear,
    list,
    hasPending,
  }
}
