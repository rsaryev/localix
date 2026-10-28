import { z } from 'zod'

import type { DecisionHost } from './backend/decision'

/**
 * Who plays the other side of a game at one table: the agent in the chat (woken for each turn,
 * answering with the game's tool), or the host's decision model (asked by the game itself, one
 * typed question per turn, `askDecisionForTurn`). Shared by every game's backend, which keeps the
 * choice with the table, and its view, which offers it (`@localixai/kit/opponent-menu`).
 */
export const OPPONENTS = ['agent', 'decision'] as const
export type Opponent = (typeof OPPONENTS)[number]

/**
 * The table's opponent, or null until it is settled: a new table — and one kept before the choice
 * existed — takes the decision model when it can answer, else the agent ({@link defaultOpponent}).
 * Once settled, or chosen by the person, it stays.
 */
export const opponentSchema = z.enum(OPPONENTS).nullable().default(null)

/** The opponent a table settles on: the decision model when one can answer for the user now. */
export async function defaultOpponent(
  decisions: Pick<DecisionHost, 'available'> | undefined,
  userId: string,
): Promise<Opponent> {
  const available = await decisions?.available(userId).catch(() => null)
  return available ? 'decision' : 'agent'
}

/** What a game's agent tool says when the decision model holds the side it would move from. */
export const DECISION_HOLDS_TURN =
  'The decision model plays your side at this table. The user can switch the opponent back to you on the board.'

/** Who plays the other side at a table, in the person's words; an unsettled table is the agent's. */
export const opponentName = (table: { opponent: Opponent | null }) =>
  table.opponent === 'decision' ? 'The decision model' : 'The agent'

/** The other opponent a table offers when the one it has did not answer, in its button's words. */
export const OTHER_OPPONENT: Record<Opponent, { opponent: Opponent; label: string }> = {
  agent: { opponent: 'decision', label: 'Use the decision model' },
  decision: { opponent: 'agent', label: 'Use the chat agent' },
}
