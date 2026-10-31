import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { WakeQueueStore } from '../wake-queue-repository'
import type { AgentTurnSource } from '../conversation-strategy'
import { ticketOf, type PendingTurn } from './entry'
import type { createContinuationOperations } from './continuations'
import { leaseHolder, type createLeaseOperations, type createWakeQueueSharedState } from './leases'
import { dismissedRun } from '../run-outcome'

export interface AgentTurnFilter {
  conversationId?: string
  source?: AgentTurnSource
  /** Tickets answering, or writing into, any of these transcript rows (a rollback removed them). */
  messageIds?: readonly string[]
}

const touches = (turn: AgentTurnTicket, messageIds: readonly string[]): boolean =>
  messageIds.includes(turn.assistantMessageId) ||
  turn.triggerMessageIds.some((id) => messageIds.includes(id))

interface AgentTurnOperationsDeps {
  shared: ReturnType<typeof createWakeQueueSharedState>
  leases: ReturnType<typeof createLeaseOperations>
  continuations: ReturnType<typeof createContinuationOperations>
  store?: WakeQueueStore<PendingTurn>
  publishQueue: (userId: string, sessionId: string) => void
}

export function createAgentTurnOperations(deps: AgentTurnOperationsDeps) {
  /** Remove pending (never leased) tickets matching every given field of the filter. */
  const cancel = async (
    userId: string,
    sessionId: string,
    filter: AgentTurnFilter = {},
  ): Promise<void> => {
    const { conversationId, source, messageIds } = filter
    await deps.leases.ready
    const queue = deps.shared.queues.get(sessionId)
    if (!queue) return
    for (const item of queue.list()) {
      const turn = ticketOf(item.value)
      if (
        !turn ||
        item.value.userId !== userId ||
        (conversationId && turn.scope.conversationId !== conversationId) ||
        (source && turn.source !== source) ||
        (messageIds && !touches(turn, messageIds))
      )
        continue
      if (leaseHolder(deps.shared, sessionId, item.id) === 'drain') continue
      if (deps.store && !(await deps.store.remove(userId, sessionId, item.id))) continue
      queue.remove(item.id)
      deps.continuations.settleCompletion(
        [item.id],
        dismissedRun('Pending conversation turn was cancelled.'),
      )
    }
    deps.publishQueue(userId, sessionId)
  }

  return { cancel }
}
