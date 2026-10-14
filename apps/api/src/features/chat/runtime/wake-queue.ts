import type { QueueItem } from '../../../lib/priority-queue'
import type { SessionQueueItem } from '../contracts'
import { createContinuationOperations } from './wake-queue/continuations'
import { createDrainOperations, type DrainOperations } from './wake-queue/drain'
import {
  createLeaseOperations,
  createWakeQueueSharedState,
  isBoundaryDeliverable,
  type PendingTurn,
} from './wake-queue/leases'
import { createPromoteOperations } from './wake-queue/promote'
import { createSteeringOperations } from './wake-queue/steering'
import type { AgentTurnAdmission } from './agent-turn-ticket'
import type { AgentTurnSource } from './conversation-strategy'
import type { WakeQueueContext } from './wake-queue-contracts'
import { createAgentTurnOperations } from './wake-queue/agent-turns'
import { createSelfWakeBudget } from './wake-queue/self-wake-budget'
import { createWake } from './wake-queue/wake'

export type { WakeQueueContext } from './wake-queue-contracts'

/** Durable event queue, serial within a session and concurrent across sessions. */
export function createWakeQueue(ctx: WakeQueueContext) {
  const { repo, streamRegistry, now, state, run, store, onError = console.warn } = ctx
  const shared = createWakeQueueSharedState(state)
  const { queues } = shared

  const selfWakeBudget = createSelfWakeBudget()
  let scheduleDrain: DrainOperations['scheduleDrain'] = () => {}
  const leases = createLeaseOperations(shared, {
    now,
    store,
    scheduleDrain: (sessionId) => scheduleDrain(sessionId),
  })
  const continuations = createContinuationOperations(shared)

  const toPublic = (item: QueueItem<PendingTurn>): SessionQueueItem => {
    const turn = item.value
    const agentTurn = turn.agentTurn
    return {
      id: item.id,
      ...(turn.clientMessageId ? { clientMessageId: turn.clientMessageId } : {}),
      kind: turn.kind,
      priority: item.priority,
      ...(agentTurn
        ? { agentId: agentTurn.speakerAgentId, agentWeight: Math.max(0, -item.priority) }
        : {}),
      preview: turn.content.slice(0, 140),
      queuedAt: turn.queuedAt,
      ...(turn.source ? { source: turn.source } : {}),
      delivery: isBoundaryDeliverable(turn) ? 'next-tool' : 'next-turn',
    }
  }

  const publishQueue = (userId: string, sessionId: string): void => {
    const q = queues.get(sessionId)
    streamRegistry.publish(userId, sessionId, {
      type: 'session_queue.updated',
      sessionId,
      queue: q ? q.list().map(toPublic) : [],
    })
  }

  const agentTurns = createAgentTurnOperations({
    shared,
    leases,
    continuations,
    store,
    publishQueue,
  })

  const drain = createDrainOperations(shared, {
    repo,
    streamRegistry,
    now,
    state,
    run,
    enqueueRun: (params, source) => enqueueRun(params, source).then(() => undefined),
    store,
    ready: leases.ready,
    onError,
    leases,
    continuations,
    publishQueue,
    ageWaitingAgentTurns: agentTurns.ageWaiting,
    cancelAgentTurns: agentTurns.cancel,
    ...(ctx.leadership ? { leadership: ctx.leadership } : {}),
    ...(ctx.inviteAddressed ? { inviteAddressed: ctx.inviteAddressed } : {}),
  })
  scheduleDrain = drain.scheduleDrain

  const steering = createSteeringOperations(shared, {
    store,
    ready: leases.ready,
    leases,
    continuations,
    publishQueue,
    toPublic,
  })

  const { interruptAndPromote } = createPromoteOperations(shared, {
    leases,
    scheduleDrain,
    queues,
    onError,
  })

  // Process restart recovery is active, not merely visible: once the startup
  // snapshot is rebuilt, every idle session gets a drain attempt. Active runs
  // and unexpired foreign leases remain protected by their normal gates.
  if (store) {
    void leases.ready
      .then(() => {
        for (const sessionId of queues.keys()) scheduleDrain(sessionId)
      })
      .catch(onError)
  }

  /**
   * Queue a turn and (re)start a run when the session is idle; if a run is active the turn
   * waits and is drained from the run's `finally`. The stages live in `wake-queue/wake.ts`.
   */
  const wake = createWake(ctx, {
    shared,
    leases,
    continuations,
    selfWakeBudget,
    publishQueue,
    scheduleDrain: (sessionId) => scheduleDrain(sessionId),
  })

  /** Drop a deleted session's queue (drains leave the empty queue in the Map). */
  const forget = async (userId: string, sessionId: string): Promise<void> => {
    await leases.ready
    if (store) await store.forgetSession(userId, sessionId)
    continuations.settleSessionCompletions(sessionId, {
      status: 'failed',
      kind: 'dismissed',
      message: 'Session was removed before its queued run executed.',
      retryable: false,
      rateLimited: false,
    })
    queues.delete(sessionId)
    selfWakeBudget.forget(sessionId)
    shared.leasedSteeringIds.delete(sessionId)
    shared.leasedDrainIds.delete(sessionId)
  }

  const setPriority = async (
    userId: string,
    sessionId: string,
    id: string,
    priority: number,
  ): Promise<boolean> => {
    if (!Number.isFinite(priority)) throw new Error('Invalid priority')
    await leases.ready
    if (shared.closed) return false
    const q = queues.get(sessionId)
    const item = q?.list().find((entry) => entry.id === id && entry.value.userId === userId)
    if (
      !item ||
      shared.leasedDrainIds.get(sessionId)?.has(id) ||
      shared.leasedSteeringIds.get(sessionId)?.has(id)
    )
      return false
    if (store && !(await store.setPriority(userId, sessionId, id, priority))) return false
    q!.setPriority(id, priority)
    publishQueue(userId, sessionId)
    scheduleDrain(sessionId)
    return true
  }

  /** Synchronous admission gate used before runner shutdown snapshots active
   * work. Durable rows are intentionally retained for next-process recovery. */
  const close = async (): Promise<void> => {
    shared.closed = true
    continuations.settleCompletion([...shared.continuationCompletions.keys()], {
      status: 'failed',
      kind: 'abort',
      message: 'Runtime shut down before the queued run completed.',
      retryable: true,
      rateLimited: false,
    })
    for (const timer of shared.recoveryTimers) clearTimeout(timer)
    shared.recoveryTimers.clear()
    for (const timer of shared.drainRetryTimers.values()) clearTimeout(timer)
    shared.drainRetryTimers.clear()
    // A recover/list query may already be in flight. Let it settle before the
    // caller destroys SQLite; closed checks above prevent another retry/query.
    await leases.ready.catch(() => {})
    await drain.close()
    // A drain may already have passed its closed check and be awaiting a
    // repository write or run finalizer. The set can only shrink
    // after closed=true because every scheduler/admission path is now gated.
    await Promise.allSettled(shared.inFlightDrains)
  }

  function enqueueRun(turn: AgentTurnAdmission, source: AgentTurnSource) {
    return wake(
      {
        userId: turn.userId,
        session: turn.session,
        content: `Turn for ${turn.scope.speakerAgentId}`,
        agentTurn: {
          speakerAgentId: turn.scope.speakerAgentId,
          assistantMessageId: turn.assistantMessageId,
          triggerMessageIds: turn.triggerMessageIds,
          source,
          scope: turn.scope,
        },
      },
      { continuation: turn.completion },
    )
  }

  return {
    enqueueRun,
    cancelAgentTurns: agentTurns.cancel,
    cancelAgentTurn: (userId: string, sessionId: string, agentId: string) =>
      agentTurns.cancel(userId, sessionId, { agentId }),
    boostReferencedAgentTurns: agentTurns.boostReferences,
    drainPendingAndRun: drain.drainPendingAndRun,
    scheduleDrain: drain.scheduleDrain,
    wake,
    remove: steering.remove,
    interruptAndPromote,
    clear: steering.clear,
    list: steering.list,
    hasPending: steering.hasPending,
    forget,
    reserveSteerable: steering.reserveSteerable,
    peekSteerable: steering.peekSteerable,
    releaseSteerable: steering.releaseSteerable,
    ackSteerable: steering.ackSteerable,
    close,
    ready: () => leases.ready,
    subscribe: drain.subscribe,
    setPriority,
  }
}
