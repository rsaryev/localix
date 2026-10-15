import type { AgentWait } from '../agent-wait'
import type { PluginWakeOutcome, PluginWakeRequest } from './host-services'

/** `ctx.host.wake` — present on the backend load, where a view's routes live. */
export type Wake = (request: PluginWakeRequest) => Promise<PluginWakeOutcome>

/**
 * Whose table: the host's user and the chat session a board belongs to. In a route both come from
 * `c.env`, where the host puts a session only after checking the user owns it; in a tool, the
 * session is the run's own (`context.session.id`).
 */
export interface Seat {
  userId: string
  sessionId: string
}

/**
 * Wake the seat's chat for the agent's turn and say what the view should show: `thinking` when
 * the chat will take it, else `unreachable` with the reason — including when this load has no
 * `wake` at all. Never throws for an undelivered wake; the caller records the answer.
 */
export async function askAgentForTurn(
  wake: Wake | undefined,
  seat: Seat,
  turn: { message: string; tools: string[]; key: string },
  now: string,
): Promise<AgentWait> {
  if (!wake) return { since: now, status: 'unreachable', reason: 'This app cannot wake a chat.' }
  const outcome = await wake({ userId: seat.userId, sessionId: seat.sessionId, ...turn })
  if (outcome.status === 'delivered') return { since: now, status: 'thinking' }
  return { since: now, status: 'unreachable', reason: outcome.reason }
}
