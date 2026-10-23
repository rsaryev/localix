import { useTableGame } from '@localixai/mini-app-sdk/ui/game-table'

import { gameSchema, owesAgentMove, type Mark, type Opponent } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'

/**
 * The board's state and the four things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`) — never the chat
 * that happens to be active. A board kept mounted in the background after the person switched
 * chats keeps reading and waking its own chat, not the one now on screen. The host checks the
 * session on every request, so a board whose chat was deleted reads nothing rather than a stale
 * game. The agent's own move arrives through its tool; the store feed nudges the board the moment
 * it lands (`useStoreSnapshot`). Only while that feed is not live does the board look for itself —
 * quickly while the agent owes a move, slowly otherwise.
 */

export function useGame(active: boolean) {
  const game = useTableGame({
    miniApp: 'tic-tac-toe',
    route: ROUTE_PATH,
    schema: gameSchema,
    active,
    quick: owesAgentMove,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  const { act } = game

  return {
    ...game,
    play: (cell: number) => act('move', { cell }),
    newGame: (first?: Mark) => act('new', first ? { first } : {}),
    remind: () => act('remind', {}),
    /** Who plays O; the route answers with O's move when the new opponent owes one. */
    setOpponent: (opponent: Opponent) => act('opponent', { opponent }),
  }
}
