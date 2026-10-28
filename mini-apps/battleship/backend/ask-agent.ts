import type { ChatRef, Wake } from '@localixai/mini-app-sdk/backend'

import { recordLine, sinceLastTurn, suggestedCells, targetGrid } from '../shared/describe'
import { viewFor, type Game } from '../shared/game'
import { cellName } from '../shared/rules'

/**
 * HOW THE BOARD ASKS THE AGENT FOR ITS SHOT — the mini app's side of the host's wake contract.
 *
 * The agent plays in the chat the board BELONGS to — never whichever chat is open now. When the
 * board needs its shot, the mini app wakes that session with what the agent may know — its own
 * side's view, never the user's fleet — and the tools that answer it (`ctx.host.wake`); the agent
 * replies by calling `battleship` to fire. Nothing here waits for that shot: the wake only says
 * whether the chat will take the turn, and the view shows the answer.
 */

export type { ChatRef, Wake }

/** The one tool a woken turn answers with — the host puts it on the wire before it starts. */
export const ANSWER_TOOLS = ['battleship']

/**
 * The words the woken turn reads; the host adds where they came from. Built from the AGENT's view
 * (`viewFor(game, 'agent')`), so the message cannot carry the user's fleet. No reply is asked for:
 * the shot that passes the turn ends it (a "fire" answers with `terminate` on a miss),
 * because the board already shows it.
 */
export function askForShot(game: Game): string {
  const view = viewFor(game, 'agent')
  const suggested = suggestedCells(view)
  const opening = view.shots.length === 0 ? ['A new game — you fire first.'] : sinceLastTurn(view)
  return [
    ...opening,
    'Your shot.',
    ...(recordLine(view.record) ? [recordLine(view.record)!] : []),
    '',
    'Your shots at the user’s board (. unknown, o water, x hit, # sunk):',
    targetGrid(view),
    '',
    suggested.length > 0
      ? `A ship is hit but afloat — call battleship with action "fire" beside it: ${suggested.map(cellName).join(', ')}.`
      : 'Call battleship with action "fire" at an unknown cell (a ".").',
  ].join('\n')
}

/**
 * One delivery per position: a double click, a retried request and a reminder for the same
 * position are the same wake while it still waits for its turn.
 */
export const positionKey = (game: Game) => `${game.id}:${game.shots.length}`
