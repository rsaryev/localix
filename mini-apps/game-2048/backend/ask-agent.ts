import { askAgentForTurn, type ChatRef, type Wake } from '@localixai/mini-app-sdk/backend'

import { describeGame } from '../shared/describe'
import { MAX_MOVES, type AgentWait, type Game } from '../shared/game'

/**
 * HOW THE BOARD HANDS ITSELF TO THE AGENT — the mini app's side of the host's wake contract.
 *
 * The agent plays in the chat the board BELONGS to. When the person hands it the board (switches
 * to "Watch" with the chat agent as the player, starts an agent game, or asks it to continue), the
 * mini app wakes that session with the position and the tool that answers it, and the agent plays
 * through `game_2048`. Nothing here waits for the moves: the wake only says whether the chat will
 * take the turn, and the view shows the answer — playing, or why it could not be reached.
 *
 * Only a person's action wakes the chat. The agent's own moves never do (the host's contract: a
 * tool that woke the agent would wake it again after every call), so the message asks for the
 * whole game in this one turn.
 */

export type { ChatRef, Wake }

/** The one tool a woken turn answers with — the host puts it on the wire before it starts. */
export const ANSWER_TOOLS = ['game_2048']

/**
 * The words the woken turn reads. They ask for the game, not for one call, and say that a
 * no-op move is skipped: the previous wording ("stop at the first invalid move", "append pause
 * when stopping") had the agent pause after every call and wait to be told to go on.
 */
export function askToPlay(game: Game): string {
  return [
    describeGame(game),
    '',
    `The user handed you the board. Play it with game_2048: action "move" with "prefer", an order of directions that keeps the largest tile in one corner (e.g. ["down","left","right","up"]); each of up to ${MAX_MOVES} moves takes the first direction that changes the board. Keep the same corner and keep calling until the game ends — the board shows every move, so do not stop to report progress.`,
  ].join('\n')
}

/**
 * One delivery per position: a double click, a retried request and a reminder for the same
 * position are the same wake while it still waits for its turn.
 */
export const positionKey = (game: Game) => `${game.id}:${game.moves}`

/** The wait the view shows after asking — or the reason nobody was asked. */
export async function askAgent(
  wake: Wake | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<AgentWait> {
  const turn = { message: askToPlay(game), tools: ANSWER_TOOLS, key: positionKey(game) }
  return askAgentForTurn(wake, chat, turn, now)
}
