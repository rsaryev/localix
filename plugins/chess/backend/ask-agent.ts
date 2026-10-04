import type { PluginWakeOutcome, PluginWakeRequest } from '@localixai/plugin-sdk/backend'

import { drawBoard, lastMoveLine, legalLine, recordLine } from '../shared/describe'
import { positionOfGame, type AgentWait, type Game } from '../shared/game'
import { other } from '../shared/position'

/**
 * HOW THE BOARD ASKS THE AGENT FOR ITS MOVE — the plugin's side of the host's wake contract.
 *
 * The agent plays in the chat the board BELONGS to — never whichever chat is open now. When the
 * board needs its move, the plugin wakes that session with the position and the tools that answer
 * it (`ctx.host.wake`), and the agent replies by calling `chess` to move. Nothing here waits for that
 * move: the wake only says whether the chat will take the turn, and the view shows the answer —
 * "thinking", or why it could not be reached — so a board never waits for a move nobody was
 * asked for.
 */

export type Wake = (request: PluginWakeRequest) => Promise<PluginWakeOutcome>

/**
 * Whose table: the host's user and the chat session the board belongs to. In a route both come
 * from `c.env`, where the host puts a session only after checking the user owns it; in a tool, the
 * session is the run's own (`context.session.id`).
 */
export interface Seat {
  userId: string
  sessionId: string
}

/** The one tool a woken turn answers with — the host puts it on the wire before it starts. */
export const ANSWER_TOOLS = ['chess']

/**
 * The words the woken turn reads; the host adds where they came from. No reply is asked for: the
 * move itself ends the turn (a "move" answers a wake with `terminate`), because the board
 * already shows it. The legal moves are listed in SAN, so the agent picks one rather than working
 * out pins and checks from a drawing; the FEN is there for the reasoning it does.
 */
export function askForMove(game: Game): string {
  const side = other(game.you)
  const { fen, inCheck } = positionOfGame(game)
  return [
    lastMoveLine(game)?.concat(` Your move as ${side}${inCheck ? ' — you are in check' : ''}.`) ??
      `A new game — you play ${side} and move first.`,
    recordLine(game.record),
    '',
    drawBoard(game),
    '',
    `FEN: ${fen}`,
    legalLine(game),
    'Call chess with action "move" and one of them — or action "resign" if the game is lost.',
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * One delivery per position: a double click, a retried request and a reminder for the same
 * position are the same wake while it still waits for its turn.
 */
export const positionKey = (game: Game) => `${game.id}:${game.moves.length}`

/** The wait the view shows after asking — or the reason nobody was asked. */
export async function askAgent(
  wake: Wake | undefined,
  seat: Seat,
  game: Game,
  now: string,
): Promise<AgentWait> {
  if (!wake) return { since: now, status: 'unreachable', reason: 'This app cannot wake a chat.' }
  const outcome = await wake({
    userId: seat.userId,
    sessionId: seat.sessionId,
    message: askForMove(game),
    tools: ANSWER_TOOLS,
    key: positionKey(game),
  })
  if (outcome.status === 'delivered') return { since: now, status: 'thinking' }
  return { since: now, status: 'unreachable', reason: outcome.reason }
}
