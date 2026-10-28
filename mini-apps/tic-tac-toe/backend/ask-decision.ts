import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
} from '@localixai/mini-app-sdk/backend'

import { LINES, freeCells, placeName, type AgentWait, type Game, type Mark } from '../shared/game'
import type { ChatRef } from './ask-agent'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS MOVE — when the table's opponent is `decision`.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the free cells, read against the position. No chat is woken and nothing is
 * written in it; the spend is recorded against the chat the board belongs to.
 *
 * The question is atomic, as System One questions should be: "which free cell is O's best move".
 * What code can see for certain — where O wins now, where X wins next — is computed here and put in
 * the state, so the model weighs a fact rather than working it out; the pick is still the model's.
 * Every option is a legal move, so the leading option is played whatever its probability
 * (`askDecisionForTurn` refuses anything outside them).
 */

export const DECISION_PURPOSE = 'move'

/** Free cells where `mark` completes a line now, numbered 1–9. */
function winningCells(board: Game['board'], mark: Mark): number[] {
  return freeCells(board)
    .filter((cell) =>
      LINES.some(
        (line) => line.includes(cell) && line.every((at) => at === cell || board[at] === mark),
      ),
    )
    .map((cell) => cell + 1)
}

/** The position from O's side, and the one question: which free cell. */
export function moveAsk(game: Game): DecisionAsk {
  const rows = [0, 3, 6].map((start) =>
    [start, start + 1, start + 2].map((cell) => game.board[cell] ?? String(cell + 1)).join(' '),
  )
  const criteria = Object.fromEntries(
    freeCells(game.board).map((cell) => [String(cell + 1), `Cell ${cell + 1}, ${placeName(cell)}`]),
  )
  return {
    state: {
      game: 'tic-tac-toe on a 3×3 board; three in a row, column or diagonal wins',
      you_play: 'O',
      opponent_plays: 'X',
      board_rows_top_to_bottom: rows,
      free_cells: Object.keys(criteria).map(Number),
      cells_where_o_wins_now: winningCells(game.board, 'O'),
      cells_where_x_wins_next: winningCells(game.board, 'X'),
    },
    questions: {
      move: {
        type: 'choice',
        instructions:
          'Which free cell is the best move for O? Take a cell where O wins now; else block a cell where X wins next; else take the centre, then a corner, then an edge, preferring a cell that makes two O lines threaten at once.',
        criteria,
      },
    },
  }
}

/** The decision model's move: the cell (0–8) to play, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ cell: number } | { waiting: AgentWait }> {
  const turn = { ask: moveAsk(game), question: 'move', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  return 'answer' in answered ? { cell: Number(answered.answer.choice) - 1 } : answered
}
