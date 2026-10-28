import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
} from '@localixai/mini-app-sdk/backend'

import { MOVES, type AgentWait, type Game, type Move } from '../shared/game'
import type { ChatRef } from './ask-agent'

/**
 * HOW THE TABLE ASKS THE DECISION MODEL FOR ITS MOVE — when the table's opponent is `decision`.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question,
 * rock, paper or scissors. Fairness is this table's whole point, so the state is built from the
 * FINISHED rounds alone — both picks and how each went — and the score. The current round never
 * reaches it: not the person's move, not its digest, not whether they have chosen. The pick is then
 * sealed exactly like the agent's, so the person sees only its digest until the round reveals both.
 */

export const DECISION_PURPOSE = 'move'

const VERDICT = { won: 'person won', lost: 'you won', draw: 'draw' } as const

/** The table from the model's side: finished rounds and the score, never the round in play. */
export function moveAsk(game: Game): DecisionAsk {
  const finished = game.history.filter(
    (round) => round.outcome !== null && round.id !== game.round.id,
  )
  return {
    state: {
      game: 'rock paper scissors: rock beats scissors, scissors beat paper, paper beats rock',
      you_play_against: 'the person',
      finished_rounds_oldest_first: finished.map((round) => ({
        round: round.number,
        person: round.you?.value ?? null,
        you: round.agent?.value ?? null,
        result: round.outcome ? VERDICT[round.outcome] : null,
      })),
      score: { you: game.record.lost, person: game.record.won, draws: game.record.draw },
      this_round: game.round.number,
    },
    questions: {
      move: {
        type: 'choice',
        instructions:
          "Which move should you play this round? The person's move for this round is sealed and unknown to you. Beat the move their earlier rounds suggest they play next; with no pattern to read, any move is as good.",
        criteria: Object.fromEntries(MOVES.map((move) => [move, `Play ${move}`])),
      },
    },
  }
}

/** The decision model's move, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ move: Move } | { waiting: AgentWait }> {
  const turn = { ask: moveAsk(game), question: 'move', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  return 'answer' in answered ? { move: answered.answer.choice as Move } : answered
}
