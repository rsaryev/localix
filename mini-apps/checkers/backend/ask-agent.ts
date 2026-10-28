import type { ChatRef, Wake } from '@localixai/mini-app-sdk/backend'

import { drawBoard, lastMoveLine, legalLine, recordLine } from '../shared/describe'
import type { Game } from '../shared/game'
import { other } from '../shared/rules'

/**
 * HOW THE BOARD ASKS THE AGENT FOR ITS MOVE — the mini app's side of the host's wake contract.
 *
 * The agent plays in the chat the board BELONGS to — never whichever chat is open now. When the
 * board needs its move, the mini app wakes that session with the position and the tools that answer
 * it (`ctx.host.wake`), and the agent replies by calling `checkers` to move. Nothing here waits for
 * that move: the wake only says whether the chat will take the turn, and the view shows the answer
 * — "thinking", or why it could not be reached — so a board never waits for a move nobody was
 * asked for.
 */

export type { ChatRef, Wake }

/** The one tool a woken turn answers with — the host puts it on the wire before it starts. */
export const ANSWER_TOOLS = ['checkers']

/**
 * The words the woken turn reads; the host adds where they came from. No reply is asked for: the
 * move itself ends the turn (a "move" answers a wake with `terminate`), because the board
 * already shows it. The legal moves are listed, so the agent copies one rather than working the
 * compulsory-capture rule out from a drawing.
 */
export function askForMove(game: Game): string {
  const side = other(game.you)
  return [
    lastMoveLine(game)?.concat(` Your move as ${side}.`) ??
      `A new game — you play ${side} and move first.`,
    recordLine(game.record),
    '',
    drawBoard(game),
    '',
    legalLine(game),
    'Call checkers with action "move" and one of them — or action "resign" if the game is lost.',
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * One delivery per position: a double click, a retried request and a reminder for the same
 * position are the same wake while it still waits for its turn.
 */
export const positionKey = (game: Game) => `${game.id}:${game.moves.length}`
