import type { AgentWait } from '../agent-wait'
import type { DecisionAsk, DecisionChoiceAnswer, DecisionHost, DecisionOutcome } from './decision'
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

/** Why a decision came back without a turn, in the words a board shows. */
const DECISION_MISSED: Record<Exclude<DecisionOutcome['status'], 'answered'>, string> = {
  unavailable:
    'No decision model is connected. Connect OpenRouter, or switch the opponent to the chat agent.',
  deadline: 'The decision model did not answer in time.',
  cancelled: 'The decision model was stopped before it answered.',
  failed: 'The decision model could not answer.',
}

/**
 * Ask the host's decision model for a game's turn — the counterpart of {@link askAgentForTurn} for a
 * table whose opponent is `decision`. `ask` holds one `choice` question under `question`, whose
 * options are the legal moves; the answer is that question's pick, every option being playable.
 * Anything else — no model, late, refused, a pick outside the options — is `unreachable` with the
 * reason the view shows, so the caller records it exactly like a wake that did not land. Never
 * throws for a missed decision.
 */
export async function askDecisionForTurn(
  decisions: DecisionHost | undefined,
  seat: Seat,
  turn: { ask: DecisionAsk; question: string; purpose: string },
  now: string,
): Promise<{ answer: DecisionChoiceAnswer } | { waiting: AgentWait }> {
  const missed = (reason: string) => ({
    waiting: { since: now, status: 'unreachable' as const, reason },
  })
  if (!decisions) return missed('This app cannot reach a decision model.')
  const outcome = await decisions.decide(seat.userId, turn.ask, {
    purpose: turn.purpose,
    sessionId: seat.sessionId,
  })
  if (outcome.status !== 'answered') return missed(DECISION_MISSED[outcome.status])
  const answer = outcome.answers[turn.question]
  const options = turn.ask.questions[turn.question]?.criteria ?? {}
  if (answer?.type !== 'choice' || !(answer.choice in options))
    return missed(DECISION_MISSED.failed)
  return { answer }
}
