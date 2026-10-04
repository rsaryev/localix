import type { SessionRecord } from '../../repository'
import { agentNameSpans, mentionSpans } from '../../agent-mentions'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { AgentTurnSource } from '../conversation-strategy'
import { agedPriority } from '../queue-policy'
import type { WakeQueueStore } from '../wake-queue-store'
import type { PendingTurn } from './leases'
import type { createContinuationOperations } from './continuations'
import type { createLeaseOperations, createWakeQueueSharedState } from './leases'

export interface AgentTurnFilter {
  conversationId?: string
  agentId?: string
  source?: AgentTurnSource
}

interface AgentTurnOperationsDeps {
  shared: ReturnType<typeof createWakeQueueSharedState>
  leases: ReturnType<typeof createLeaseOperations>
  continuations: ReturnType<typeof createContinuationOperations>
  store?: WakeQueueStore<PendingTurn>
  publishQueue: (userId: string, sessionId: string) => void
}

export function createAgentTurnOperations(deps: AgentTurnOperationsDeps) {
  const priorityPrecision = (value: number) => Math.round(value * 100) / 100
  const changePriorities = async (
    userId: string,
    sessionId: string,
    select: (turn: AgentTurnTicket, priority: number) => boolean,
    delta: number | ((turn: AgentTurnTicket, priority: number) => number),
  ): Promise<void> => {
    const queue = deps.shared.queues.get(sessionId)
    if (!queue) return
    const updates = queue.list().flatMap((item) => {
      const turn =
        item.value.kind === 'user' || item.value.kind === 'wake' ? item.value.agentTurn : undefined
      if (
        !turn ||
        item.value.userId !== userId ||
        deps.leases.isLeased(sessionId, item.id) ||
        !select(turn, item.priority)
      )
        return []
      const adjustment = typeof delta === 'number' ? delta : delta(turn, item.priority)
      const priority = priorityPrecision(item.priority + adjustment)
      return priority === item.priority ? [] : [{ id: item.id, priority }]
    })
    if (updates.length === 0) return
    const persisted = deps.store?.setPriorities
      ? await deps.store.setPriorities(userId, sessionId, updates)
      : !deps.store ||
        (
          await Promise.all(
            updates.map((update) =>
              deps.store!.setPriority(userId, sessionId, update.id, update.priority),
            ),
          )
        ).every(Boolean)
    if (!persisted) throw new Error('Pending agent priorities changed while being updated')
    for (const update of updates) queue.setPriority(update.id, update.priority)
    deps.publishQueue(userId, sessionId)
  }

  /** Remove pending (never leased) tickets matching every given field of the filter. */
  const cancel = async (
    userId: string,
    sessionId: string,
    filter: AgentTurnFilter = {},
  ): Promise<void> => {
    const { conversationId, agentId, source } = filter
    await deps.leases.ready
    const queue = deps.shared.queues.get(sessionId)
    if (!queue) return
    for (const item of queue.list()) {
      const turn =
        item.value.kind === 'user' || item.value.kind === 'wake' ? item.value.agentTurn : undefined
      if (
        !turn ||
        item.value.userId !== userId ||
        (conversationId && turn.scope.conversationId !== conversationId) ||
        (agentId && turn.speakerAgentId !== agentId) ||
        (source && turn.source !== source)
      )
        continue
      if (deps.shared.leasedDrainIds.get(sessionId)?.has(item.id)) continue
      if (deps.store && !(await deps.store.remove(userId, sessionId, item.id))) continue
      queue.remove(item.id)
      deps.continuations.settleCompletion([item.id], {
        status: 'failed',
        kind: 'dismissed',
        message: 'Pending conversation turn was cancelled.',
        retryable: false,
        rateLimited: false,
      })
    }
    deps.publishQueue(userId, sessionId)
  }

  const boostReferences = async (
    userId: string,
    session: Pick<SessionRecord, 'id' | 'agents'>,
    speakerAgentId: string,
    text: string,
  ): Promise<void> => {
    const handles = session.agents.map((agent) => agent.handle)
    const weightByHandle = new Map<string, number>()
    for (const span of mentionSpans(text, handles)) {
      weightByHandle.set(span.handle, (weightByHandle.get(span.handle) ?? 0) + 0.1)
    }
    for (const span of agentNameSpans(text, handles)) {
      weightByHandle.set(span.handle, (weightByHandle.get(span.handle) ?? 0) + 0.05)
    }
    const weightByAgentId = new Map(
      session.agents
        .filter((agent) => agent.agentId !== speakerAgentId && weightByHandle.has(agent.handle))
        .map((agent) => [agent.agentId, weightByHandle.get(agent.handle)!] as const),
    )
    if (weightByAgentId.size === 0) return
    await changePriorities(
      userId,
      session.id,
      (turn, priority) => priority < 0 && weightByAgentId.has(turn.speakerAgentId),
      (turn) => -(weightByAgentId.get(turn.speakerAgentId) ?? 0),
    )
  }

  return {
    // Every dispatch moves waiting tickets one step forward so none starves — within its band:
    // a colleague chain ages toward, never past, the person's next message.
    ageWaiting: (userId: string, sessionId: string) =>
      changePriorities(
        userId,
        sessionId,
        () => true,
        (turn, priority) => agedPriority(turn.source, priority) - priority,
      ),
    cancel,
    boostReferences,
  }
}
