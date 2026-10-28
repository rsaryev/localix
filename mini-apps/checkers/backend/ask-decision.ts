import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
} from '@localixai/mini-app-sdk/backend'

import { movesNow, type AgentWait, type Game } from '../shared/game'
import { moveName, squareName, squaresOf } from '../shared/notation'
import { countPieces, other, type Play } from '../shared/rules'
import { drawBoard } from '../shared/describe'
import type { ChatRef } from './ask-agent'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS MOVE — when the table's opponent is `decision`.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the legal moves the rules allow now, in the notation the tool takes ("c3-d4",
 * "c3:e5:g3" through every landing square). No chat is woken and nothing is written in it; the
 * spend is recorded against the chat the board belongs to.
 *
 * The question is atomic — "which legal move is best" — and what code can see for certain is put in
 * the state: the board, the side to move, the pieces left, and for each move how many pieces it
 * takes and whether it crowns. Captures are compulsory, so when there is one every option already
 * is one. Every option is a legal move, so the leading option is played whatever its probability
 * (`askDecisionForTurn` refuses anything outside them).
 */

export const DECISION_PURPOSE = 'move'

/** "c3:e5:g3 — captures 2 pieces, crowns a king" — a move in plain words. */
function describePlay(play: Play): string {
  const steps = squaresOf(play).map(squareName)
  const taken = play.captured.length
  const what =
    taken > 0
      ? `captures ${taken === 1 ? '1 piece' : `${taken} pieces`}, from ${steps[0]} to ${steps.at(-1)}`
      : `moves from ${steps[0]} to ${steps.at(-1)}`
  return `${moveName(play)}: ${what}${play.crowned ? ', and crowns a king' : ''}`
}

/** The position from the decision model's side, and the one question: which legal move. */
export function moveAsk(game: Game): DecisionAsk {
  const side = other(game.you)
  const legal = movesNow(game)
  const criteria = Object.fromEntries(legal.map((play) => [moveName(play), describePlay(play)]))
  return {
    state: {
      game: 'Russian draughts (checkers) on an 8×8 board: men move diagonally forward, capture forward and backward, and captures are compulsory; a man reaching the far rank becomes a flying king; a side with no legal move loses',
      you_play: side,
      opponent_plays: game.you,
      board_from_white_side: drawBoard(game),
      board_legend: 'w/b men, W/B kings, "." an empty dark square',
      pieces_left: {
        [side]: countPieces(game.board, side),
        [game.you]: countPieces(game.board, game.you),
      },
      capture_is_compulsory: legal.some((play) => play.captured.length > 0),
      legal_moves: legal.map((play) => ({
        move: moveName(play),
        captures: play.captured.length,
        crowns: play.crowned,
      })),
    },
    questions: {
      move: {
        type: 'choice',
        instructions: `Which legal move is best for ${side}? Prefer the move that captures the most pieces or crowns a king, keep pieces protected so the opponent cannot capture them next, and advance men safely toward the far rank.`,
        criteria,
      },
    },
  }
}

/** The decision model's move: the squares it visits, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ squares: number[] } | { waiting: AgentWait }> {
  const turn = { ask: moveAsk(game), question: 'move', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  if (!('answer' in answered)) return answered
  const play = movesNow(game).find((candidate) => moveName(candidate) === answered.answer.choice)
  return play
    ? { squares: squaresOf(play) }
    : {
        waiting: {
          since: now,
          status: 'unreachable',
          reason: 'The decision model could not answer.',
        },
      }
}
