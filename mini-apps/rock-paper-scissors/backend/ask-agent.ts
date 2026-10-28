import type { ChatRef, Wake } from '@localixai/mini-app-sdk/backend'

import { describeForAgent } from '../shared/describe'
import { viewFor, type Game } from '../shared/game'

/**
 * HOW THE TABLE ASKS THE AGENT FOR ITS MOVE — the mini app's side of the host's wake contract.
 *
 * The agent plays in the chat the table BELONGS to. When a round needs its move, the mini app wakes
 * that session with the round as the AGENT may see it — the user's move, if they opened, only as
 * a digest — and the tool that answers it. Nothing here waits for the move: the view shows
 * "thinking", or why the chat could not be reached.
 */

export type { ChatRef, Wake }

/** The one tool a woken turn answers with — the host puts it on the wire before it starts. */
export const ANSWER_TOOLS = ['rock_paper_scissors']

/** The words the woken turn reads. The move itself ends the turn, so no reply is asked for. */
export function askForMove(game: Game): string {
  return [
    describeForAgent(viewFor(game, 'agent')),
    '',
    'Call rock_paper_scissors with action "play" and your move: rock, paper or scissors. Do not name or hint at your move anywhere else.',
  ].join('\n')
}

/** One delivery per round: a double click and a reminder for the same round are the same wake. */
export const roundKey = (game: Game) => `${game.id}:${game.round.id}`
