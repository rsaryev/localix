import type { WakeSource } from '../../contracts'
import type { AgentTurnSource } from '../conversation-strategy'

/**
 * Bounds wake chains the agent causes itself. A background job whose result prompts
 * another job, or a sub-agent report that prompts another delegation, can otherwise keep
 * a session running with no person in the loop.
 *
 * The budget counts the SELF-EXCITING chain, not the queue: an over-budget wake is still
 * enqueued and still delivered — it only loses the right to open a turn of its own, and
 * waits for the next externally caused turn. Dropping it would lose the very output the
 * agent is waiting for.
 *
 * Addressed tickets are how every turn actually executes, so they must not be read as
 * "an external event": the drain fans each counted wake out into `runtime` tickets, and
 * a ticket that reset the streak would erase the wake that produced it (the streak could
 * then never pass 1). A ticket resets only when a person caused it (`user-*`); every
 * other ticket is the continuation of something already counted.
 */
export const SELF_CAUSED_WAKES: ReadonlySet<WakeSource> = new Set<WakeSource>([
  'bg-job',
  'bg-monitor',
  'subagent',
  'hook',
  // Every run of a delegated child reports, and a report can prompt another message: parent and
  // child could ping-pong with nobody in the loop. `subagent` bounds the parent's side of that
  // chain; this bounds the child's.
  'delegator',
])
export const MAX_CONSECUTIVE_SELF_WAKES = 12

const USER_TICKET_SOURCES: ReadonlySet<AgentTurnSource> = new Set<AgentTurnSource>(['user-default'])

export interface BudgetedItem {
  internal: boolean
  source?: WakeSource
  agentTurn?: { source: AgentTurnSource }
}

type BudgetEffect = 'count' | 'reset' | 'neutral'

function budgetEffect(item: BudgetedItem): BudgetEffect {
  if (item.agentTurn) return USER_TICKET_SOURCES.has(item.agentTurn.source) ? 'reset' : 'neutral'
  if (item.internal && item.source !== undefined && SELF_CAUSED_WAKES.has(item.source))
    return 'count'
  return 'reset'
}

export function createSelfWakeBudget() {
  const streaks = new Map<string, number>()
  return {
    /** Record one admitted item; false when it may NOT open a turn of its own. */
    admit(sessionId: string, item: BudgetedItem): boolean {
      const effect = budgetEffect(item)
      if (effect === 'neutral') return true
      if (effect === 'reset') {
        streaks.delete(sessionId)
        return true
      }
      const streak = (streaks.get(sessionId) ?? 0) + 1
      streaks.set(sessionId, streak)
      return streak <= MAX_CONSECUTIVE_SELF_WAKES
    },
    forget(sessionId: string): void {
      streaks.delete(sessionId)
    },
  }
}
