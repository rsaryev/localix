import type { ChatRef, Wake } from '@localixai/mini-app-sdk/backend'

import { drawBoard, lastMoveLine, recordLine, threatLine } from '../shared/describe'
import { freeCells, type Game } from '../shared/game'

/**
 * HOW THE BOARD ASKS THE AGENT FOR ITS MOVE — the mini app's side of the host's wake contract.
 *
 * The agent plays in the chat the board BELONGS to — never whichever chat is open now. When the
 * board needs its move, the mini app wakes that session with the position and the tools that answer
 * it (`ctx.host.wake`), and the agent replies by calling `tic_tac_toe` to move. Nothing here waits for
 * that move: the wake only says whether the chat will take the turn, and the view shows the answer
 * — "thinking", or why it could not be reached — so a board never waits for a move nobody was
 * asked for.
 */

export type { ChatRef, Wake }

/** The one tool a woken turn answers with — the host puts it on the wire before it starts. */
export const ANSWER_TOOLS = ['tic_tac_toe']

/**
 * The words the woken turn reads; the host adds where they came from. No reply is asked for: the
 * move itself ends the turn (a "move" answers a wake with `terminate`), because the
 * board already shows it — a chat line repeating "your turn" cost a second model call per move.
 */
export function askForMove(game: Game): string {
  const free = freeCells(game.board).map((cell) => cell + 1)
  return [
    lastMoveLine(game)?.concat(' Your move as O.') ?? 'A new game — you move first, as O.',
    recordLine(game.record),
    '',
    drawBoard(game),
    '',
    threatLine(game),
    `Call tic_tac_toe with action "move" and one of the free cells: ${free.join(', ')}.`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * One delivery per position: a double click, a retried request and a reminder for the same
 * position are the same wake while it still waits for its turn.
 */
export const positionKey = (game: Game) => `${game.id}:${game.moves.length}`
