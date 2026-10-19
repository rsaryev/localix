import type { DecisionAsk, DecisionHost, DecisionOutcome } from '@localixai/plugin-sdk/backend'

import { LINES, freeCells, placeName, type AgentWait, type Game, type Mark } from '../shared/game'
import type { Seat } from './ask-agent'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS MOVE — when the table's opponent is `decision`.
 *
 * The plugin asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the free cells, read against the position. No chat is woken and nothing is
 * written in it; the spend is recorded against the chat the board belongs to.
 *
 * The question is atomic, as System One questions should be: "which free cell is O's best move".
 * What code can see for certain — where O wins now, where X wins next — is computed here and put in
 * the state, so the model weighs a fact rather than working it out; the pick is still the model's.
 * Every option is a legal move, so the leading option is played whatever its probability.
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

/** The position from O's seat, and the one question: which free cell. */
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

/** Why a decision came back without a move, in the words the board shows. */
const MISSED: Record<Exclude<DecisionOutcome['status'], 'answered'>, string> = {
  unavailable:
    'No decision model is connected. Connect OpenRouter, or switch the opponent to the chat agent.',
  deadline: 'The decision model did not answer in time.',
  cancelled: 'The decision model was stopped before it answered.',
  failed: 'The decision model could not answer.',
}

/** The decision model's move: the cell (0–8) to play, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  seat: Seat,
  game: Game,
  now: string,
): Promise<{ cell: number } | { waiting: AgentWait }> {
  if (!decisions)
    return {
      waiting: {
        since: now,
        status: 'unreachable',
        reason: 'This app cannot reach a decision model.',
      },
    }
  const outcome = await decisions.decide(seat.userId, moveAsk(game), {
    purpose: DECISION_PURPOSE,
    sessionId: seat.sessionId,
  })
  if (outcome.status !== 'answered')
    return { waiting: { since: now, status: 'unreachable', reason: MISSED[outcome.status] } }
  const answer = outcome.answers.move
  const cell = answer?.type === 'choice' ? Number(answer.choice) - 1 : Number.NaN
  if (!Number.isInteger(cell) || game.board[cell] !== null)
    return { waiting: { since: now, status: 'unreachable', reason: MISSED.failed } }
  return { cell }
}
