/**
 * `wake()` — the one admission path every turn that is not typed into an idle session takes: a
 * busy user send (priority 0), async wakes (priority 10: sub-agent and background-job
 * completions, loop fires, plugin wakes) and addressed agent tickets.
 *
 * Its stages run in a fixed order because each one guards the next: validate (the session gate
 * is held through admission) → merge (a second address to a participant that is still waiting
 * folds into its pending ticket instead of queueing a duplicate turn) → persist (the in-memory
 * queue and the durable row move together, or neither does) → budget (an agent-caused chain
 * may queue but not open another turn once `SELF_CAUSED_WAKES` is spent) → schedule (drain
 * now, or from the active run's `finally`).
 */
import { randomUUID } from 'node:crypto'

import { createPriorityQueue, type PriorityQueue } from '../../../../lib/priority-queue'
import { defaultQueuePolicy } from '../queue-policy'
import { createRunCompletion, type RunCompletion, type RunExecutionOutcome } from '../run-outcome'
import type { EnqueueParams, WakeOptions, WakeQueueContext } from '../wake-queue-contracts'
import type { ContinuationOperations } from './continuations'
import type { LeaseOperations, PendingTurn, WakeQueueSharedState } from './leases'
import { mergeAgentTicket, retireSupersededSlot } from './merge-ticket'
import type { createSelfWakeBudget } from './self-wake-budget'

export interface WakeDeps {
  shared: WakeQueueSharedState
  leases: LeaseOperations
  continuations: ContinuationOperations
  selfWakeBudget: ReturnType<typeof createSelfWakeBudget>
  publishQueue: (userId: string, sessionId: string) => void
  /** Late-bound: the drain that owns scheduling is built after the queue that feeds it. */
  scheduleDrain: (sessionId: string) => void
}

export function createWake(ctx: WakeQueueContext, deps: WakeDeps) {
  const { now, store } = ctx
  const { shared, leases, continuations, selfWakeBudget, publishQueue, scheduleDrain } = deps
  const { activeRuns, drainingSessions, queues } = shared

  /**
   * Validate. Admission itself is part of the busy window: while startup hydration or the
   * durable INSERT is pending, a competing direct turn or control mutation must not pass the
   * session gate, so the gate is taken here and handed back as its release.
   */
  const enterIngress = async (sessionId: string): Promise<() => void> => {
    if (shared.closed) throw new Error('wake queue is shutting down')
    const owns = Boolean(store && !activeRuns.has(sessionId) && !drainingSessions.has(sessionId))
    if (owns) drainingSessions.add(sessionId)
    const release = () => {
      if (owns) drainingSessions.delete(sessionId)
    }
    try {
      if (store) await leases.ready
      if (shared.closed) throw new Error('wake queue is shutting down')
    } catch (error) {
      release()
      throw error
    }
    return release
  }

  const queueOf = (sessionId: string): PriorityQueue<PendingTurn> => {
    let q = queues.get(sessionId)
    if (!q) {
      q = createPriorityQueue<PendingTurn>()
      queues.set(sessionId, q)
    }
    return q
  }

  /**
   * A waiter attached to a turn that never took its request would hang forever. So a fold
   * attaches observers only AFTER the fold is durable, and a new turn attaches them before its
   * insert and `persistNewTurn`'s rollback detaches them again.
   */
  const attachObservers = (
    id: string,
    sessionId: string,
    options: WakeOptions | undefined,
  ): RunCompletion | undefined => {
    const waiter = options?.waitForCompletion
      ? (options.continuation ?? createRunCompletion())
      : undefined
    if (options?.continuation) continuations.attachContinuation(id, sessionId, options.continuation)
    if (waiter) continuations.attachContinuation(id, sessionId, waiter)
    return waiter
  }

  /**
   * Merge. A LEASED ticket is already being dispatched: folding into it would target a row the
   * store no longer treats as pending, so only an unleased one is a fold target.
   */
  const pendingTicketOf = (q: PriorityQueue<PendingTurn>, params: EnqueueParams) => {
    const speaker = params.agentTurn?.speakerAgentId
    if (speaker === undefined) return undefined
    const item = q
      .list()
      .find(
        (entry) =>
          entry.value.agentTurn?.speakerAgentId === speaker &&
          !leases.isLeased(params.session.id, entry.id),
      )
    return item?.value.agentTurn ? { item, ticket: item.value.agentTurn } : undefined
  }

  const foldIntoPending = async (
    q: PriorityQueue<PendingTurn>,
    pending: NonNullable<ReturnType<typeof pendingTicketOf>>,
    params: EnqueueParams,
    priority: number,
  ): Promise<void> => {
    const { userId, session } = params
    const merge = mergeAgentTicket(
      { ticket: pending.ticket, priority: pending.item.priority },
      { ticket: params.agentTurn!, priority },
    )
    if (!merge.changed) return
    const id = pending.item.id
    const mergedValue = { ...pending.item.value, agentTurn: merge.ticket }
    if (
      store &&
      !(store.updatePending
        ? await store.updatePending(userId, session.id, id, merge.priority, mergedValue)
        : await store.setPriority(userId, session.id, id, merge.priority))
    )
      throw new Error('Pending agent ticket changed while being promoted')
    q.update(id, mergedValue)
    q.setPriority(id, merge.priority)
    publishQueue(userId, session.id)
    if (merge.supersededSlot)
      await retireSupersededSlot(ctx, userId, session.id, merge.supersededSlot)
  }

  /**
   * Persist. The in-memory queue shows the turn at once; a durable row the store refuses
   * (`false`: a duplicate delivery key, or a once-ever `receipt` already spent) or fails to
   * write takes the in-memory copy and its observers back with it, so the two never disagree
   * about what is queued.
   */
  const persistNewTurn = async (
    q: PriorityQueue<PendingTurn>,
    id: string,
    value: PendingTurn,
    params: EnqueueParams,
    priority: number,
    release: () => void,
  ): Promise<boolean> => {
    const { userId, session } = params
    q.enqueue(value, { id, priority })
    publishQueue(userId, session.id)
    if (!store) return true
    const rollback = () => {
      q.remove(id)
      continuations.detachContinuations([id])
      release()
      publishQueue(userId, session.id)
    }
    try {
      const admitted = await store.enqueue({
        id,
        userId,
        sessionId: session.id,
        priority,
        kind: value.kind,
        payload: value,
        deliveryKey: id,
        queuedAt: value.queuedAt,
        ...(params.receipt && id === params.deliveryKey ? { receipt: true } : {}),
      })
      if (admitted === false) rollback()
      return admitted !== false
    } catch (error) {
      rollback()
      throw error
    }
  }

  const pendingValue = (params: EnqueueParams, internal: boolean): PendingTurn => ({
    userId: params.userId,
    content: params.content,
    ...(params.clientMessageId ? { clientMessageId: params.clientMessageId } : {}),
    extraDisabledTools: params.extraDisabledTools,
    ...(params.plugins?.length ? { plugins: params.plugins } : {}),
    internal,
    kind: internal ? 'wake' : 'user',
    source: params.source,
    bindings: params.bindings,
    toolSurface: params.toolSurface,
    executionContext: params.executionContext,
    to: params.to,
    ...(params.addressedAs !== undefined ? { addressedAs: params.addressedAs } : {}),
    queuedAt: now(),
    agentTurn: params.agentTurn,
    ...(params.command ? { command: params.command } : {}),
  })

  return async function wake(
    params: EnqueueParams,
    options?: WakeOptions,
  ): Promise<RunExecutionOutcome | void> {
    const sessionId = params.session.id
    const release = await enterIngress(sessionId)
    const internal = params.internal ?? true
    const q = queueOf(sessionId)
    try {
      const priority = (ctx.policy ?? defaultQueuePolicy).priority(
        params.agentTurn
          ? { kind: 'agent-turn', producer: params.agentTurn.source }
          : params.source || internal
            ? { kind: 'wake', producer: params.source }
            : { kind: 'user' },
      )

      const pending = pendingTicketOf(q, params)
      if (pending) {
        await foldIntoPending(q, pending, params, priority)
        const waiter = attachObservers(pending.item.id, sessionId, options)
        release()
        if (!activeRuns.has(sessionId)) scheduleDrain(sessionId)
        return waiter?.promise
      }

      const id = params.agentTurn
        ? `agent-turn-${params.agentTurn.assistantMessageId}`
        : (params.deliveryKey ?? randomUUID())
      // The same delivery arriving twice (a retried producer) joins the turn already queued.
      if (q.list().some((item) => item.id === id)) {
        release()
        return options?.waitForCompletion
          ? continuations.deliveryCompletion(id)?.promise
          : undefined
      }
      const value = pendingValue(params, internal)
      const waiter = attachObservers(id, sessionId, options)
      if (!(await persistNewTurn(q, id, value, params, priority, release))) return undefined
      release()

      const mayOpenTurn = selfWakeBudget.admit(sessionId, value)
      if (!activeRuns.has(sessionId) && mayOpenTurn) scheduleDrain(sessionId)
      return waiter?.promise
    } catch (error) {
      release()
      throw error
    }
  }
}
