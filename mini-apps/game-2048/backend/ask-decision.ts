import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
} from '@localixai/mini-app-sdk/backend'

import {
  legalDirections,
  shift,
  SIZE,
  type AgentWait,
  type Direction,
  type Game,
} from '../shared/game'
import type { ChatRef } from './ask-agent'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS NEXT MOVE — when the decision model plays it.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the directions that change the board now, read against the grid. No chat is
 * woken and nothing is written in it; the spend is recorded against the chat the board belongs to.
 *
 * The question is atomic: "which direction is the best next move". What code can see for certain
 * about each direction — the merges it makes, the points, the empty cells after it, whether the
 * largest tile stays in a corner — is computed here and put in the state, so the model weighs
 * facts rather than sliding tiles in its head; the pick is still the model's. Every option moves
 * the board, so the leading option is played (`askDecisionForTurn` refuses anything else).
 */

export const DECISION_PURPOSE = 'move'

const DESCRIPTIONS: Record<Direction, string> = {
  up: 'Slide every tile up',
  down: 'Slide every tile down',
  left: 'Slide every tile left',
  right: 'Slide every tile right',
}

const CORNERS = [0, SIZE - 1, SIZE * (SIZE - 1), SIZE * SIZE - 1]

/** Whether the largest tile on `board` sits in a corner. */
const largestInCorner = (board: readonly number[]) => {
  const largest = Math.max(...board)
  return CORNERS.some((cell) => board[cell] === largest)
}

/** The grid, the score and what each legal direction would do; the one question: which. */
export function moveAsk(game: Game): DecisionAsk {
  const legal = legalDirections(game.board)
  const rows = Array.from({ length: SIZE }, (_, row) =>
    game.board
      .slice(row * SIZE, row * SIZE + SIZE)
      .map((value) => String(value || '.'))
      .join(' '),
  )
  const outcomes = Object.fromEntries(
    legal.map((direction) => {
      const moved = shift(game.board, direction)
      return [
        direction,
        {
          merges: moved.merges.length,
          points: moved.points,
          empty_cells_after: moved.board.filter((value) => value === 0).length,
          largest_tile_stays_in_a_corner: largestInCorner(moved.board),
        },
      ]
    }),
  )
  return {
    state: {
      game: '2048 on a 4×4 grid: a move slides every tile one way, equal neighbours merge, then a 2 or 4 appears in an empty cell; no move left ends the game',
      grid_rows_top_to_bottom: rows,
      score: game.score,
      largest_tile: Math.max(...game.board),
      largest_tile_in_a_corner: largestInCorner(game.board),
      what_each_direction_does: outcomes,
    },
    questions: {
      move: {
        type: 'choice',
        instructions:
          'Which direction is the best next move? Keep the largest tile in its corner, prefer moves that merge and leave more empty cells, and avoid a move that pulls the largest tile out of its corner unless no other move keeps the game going.',
        criteria: Object.fromEntries(
          legal.map((direction) => [direction, DESCRIPTIONS[direction]]),
        ),
      },
    },
  }
}

/** The decision model's next move, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ direction: Direction } | { waiting: AgentWait }> {
  const turn = { ask: moveAsk(game), question: 'move', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  return 'answer' in answered ? { direction: answered.answer.choice as Direction } : answered
}
