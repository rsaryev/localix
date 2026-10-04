import type { QueueItem } from '../../../../lib/priority-queue'
import type {
  QueueClearResult,
  QueueRemovalResult,
  SessionQueueItem,
  WakeSource,
} from '../../contracts'
import type { WakeQueueStore } from '../wake-queue-store'
import type { ContinuationOperations } from './continuations'
import type { LeaseOperations, PendingTurn, WakeQueueSharedState } from './leases'
import { isBoundaryDeliverable, isDelegatorMessage } from './leases'
import { hasExecutionOverrides } from '../wake-queue-selection'

/** A completed child report may join its delegator's next model sample after a full tool turn.
 * Other machine wakes still own separate runs; this predicate never changes the public
 * next-turn delivery hint or the ordinary user-steering path. */
const isSubagentReport = (turn: PendingTurn): boolean =>
  turn.kind === 'wake' &&
  turn.internal &&
  turn.source === 'subagent' &&
  !turn.agentTurn &&
  !turn.bindings?.length &&
  !hasExecutionOverrides(turn)

export interface SubagentSteeringAddress {
  participant: string
  allowUnaddressed: boolean
}

interface SteeringDependencies {
  store?: WakeQueueStore<PendingTurn>
  ready: Promise<void>
  leases: LeaseOperations
  continuations: ContinuationOperations
  publishQueue: (userId: string, sessionId: string) => void
  toPublic: (item: QueueItem<PendingTurn>) => SessionQueueItem
}

export const createSteeringOperations = (
  shared: WakeQueueSharedState,
  { store, ready, leases, continuations, publishQueue, toPublic }: SteeringDependencies,
) => {
  const { claim, ack, release, isLeased } = leases
  const { settleCompletion } = continuations

  /** Reserve steerable user turns (or one addressed child report at a settled tool seam)
   * without removing them. The caller acknowledges only after committing a transcript row. */
  const reserveLocal = (
    sessionId: string,
    accepts?: (content: string) => boolean,
    subagent?: SubagentSteeringAddress,
  ): Array<{
    id: string
    userId: string
    content: string
    queuedAt: string
    source?: WakeSource
    internal: boolean
    clientMessageId?: string
  }> => {
    const q = shared.queues.get(sessionId)
    if (!q || q.size() === 0) return []
    const leased = shared.leasedSteeringIds.get(sessionId) ?? new Set<string>()
    const steerable = q
      .list()
      .filter(
        (it) =>
          !leased.has(it.id) &&
          !shared.leasedDrainIds.get(sessionId)?.has(it.id) &&
          // A caller awaiting the logical terminal outcome must keep this row
          // on the standalone run path; steering is absorbed by another run and
          // cannot provide an independent completion result.
          !shared.continuationCompletions.has(it.id) &&
          // Deliver one eligible item per model-turn boundary. The extra report
          // predicate is opt-in and never changes what the ordinary queue drains.
          (isBoundaryDeliverable(it.value) || (subagent && isSubagentReport(it.value))),
      )
      .slice(0, 1)
    const first = steerable[0]
    if (!first) return []
    // A message the running participant is not addressed by is not taken — and nothing after
    // it is either: skipping ahead would answer a later message before the earlier one, which
    // then runs as its own turn once this run ends.
    // A delegator's message is for the child's one agent, and taking it is its only way in.
    if (first.value.kind === 'wake' && !isDelegatorMessage(first.value)) {
      const recipient = first.value.to?.participant
      if (
        !subagent ||
        (recipient ? recipient !== subagent.participant : !subagent.allowUnaddressed)
      )
        return []
    } else if (accepts && !accepts(first.value.content)) return []
    leased.add(first.id)
    shared.leasedSteeringIds.set(sessionId, leased)
    return [
      {
        id: first.id,
        userId: first.value.userId,
        content: first.value.content,
        queuedAt: first.value.queuedAt,
        internal: first.value.internal,
        ...(first.value.clientMessageId ? { clientMessageId: first.value.clientMessageId } : {}),
        ...(first.value.source ? { source: first.value.source } : {}),
      },
    ]
  }

  const reserveSteerable = (
    sessionId: string,
    accepts?: (content: string) => boolean,
    subagent?: SubagentSteeringAddress,
  ): ReturnType<typeof reserveLocal> | Promise<ReturnType<typeof reserveLocal>> => {
    if (!store) return reserveLocal(sessionId, accepts, subagent)
    return (async () => {
      await ready
      const candidate = reserveLocal(sessionId, accepts, subagent)
      const first = candidate[0]
      if (!first) return []
      if (await claim(first.userId, sessionId, [first.id])) return candidate
      const leased = shared.leasedSteeringIds.get(sessionId)
      leased?.delete(first.id)
      if (leased?.size === 0) shared.leasedSteeringIds.delete(sessionId)
      return []
    })()
  }

  const releaseSteerable = (sessionId: string, itemId: string): void | Promise<void> => {
    const leased = shared.leasedSteeringIds.get(sessionId)
    const item = shared.queues
      .get(sessionId)
      ?.list()
      .find((candidate) => candidate.id === itemId)
    leased?.delete(itemId)
    if (leased?.size === 0) shared.leasedSteeringIds.delete(sessionId)
    if (store && item) return release(item.value.userId, sessionId, [itemId])
  }

  const ackSteerableLocal = (userId: string, sessionId: string, itemId: string): boolean => {
    const removed = shared.queues.get(sessionId)?.remove(itemId) ?? false
    const leased = shared.leasedSteeringIds.get(sessionId)
    leased?.delete(itemId)
    if (leased?.size === 0) shared.leasedSteeringIds.delete(sessionId)
    if (removed) publishQueue(userId, sessionId)
    return removed
  }

  const ackSteerable = (
    userId: string,
    sessionId: string,
    itemId: string,
  ): boolean | Promise<boolean> => {
    if (!store) return ackSteerableLocal(userId, sessionId, itemId)
    return ack(userId, sessionId, [itemId]).then((owned) =>
      owned ? ackSteerableLocal(userId, sessionId, itemId) : false,
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
      if (!q.list().some((candidate) => candidate.id === itemId)) {
        return { removed: false, reason: 'not_found' }
      }
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
      if (isLeased(sessionId, item.id)) retained.push(item.id)
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
        if (isLeased(sessionId, item.id)) retained.push(item.id)
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
    return q ? q.list().map(toPublic) : []
  }

  const list = (sessionId: string): SessionQueueItem[] | Promise<SessionQueueItem[]> =>
    store ? ready.then(() => listLocal(sessionId)) : listLocal(sessionId)

  const hasPendingLocal = (sessionId: string): boolean =>
    (shared.queues.get(sessionId)?.size() ?? 0) > 0
  const hasPending = (sessionId: string): boolean | Promise<boolean> =>
    store ? ready.then(() => hasPendingLocal(sessionId)) : hasPendingLocal(sessionId)

  return {
    reserveSteerable,
    releaseSteerable,
    ackSteerable,
    remove,
    clear,
    list,
    hasPending,
  }
}
