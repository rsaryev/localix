import { useTableGame } from '@localixai/mini-app-sdk/ui/game-table'

import {
  playerViewSchema,
  viewOwesAgentMove,
  type Move,
  type Opponent,
  type Player,
} from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'

/**
 * The table as the person may see it, and the four things they can do at it.
 *
 * Every request names the chat the table BELONGS to (`useWorkItemSessionId`), never the active
 * one. The routes answer with the person's view only — the agent's sealed move arrives as its
 * digest. The store feed nudges the table the moment the agent's move lands; only while that feed
 * is not live does the table poll — quickly while the agent owes a move, slowly otherwise.
 */

export function useGame(active: boolean) {
  const game = useTableGame({
    miniApp: 'rock-paper-scissors',
    route: ROUTE_PATH,
    schema: playerViewSchema,
    active,
    quick: viewOwesAgentMove,
    failureMessage: 'The table could not be read. Check that Localix is running, then retry.',
  })
  const { act } = game

  return {
    ...game,
    play: (move: Move) => act('play', { move }),
    nextRound: (first?: Player) => act('next', first ? { first } : {}),
    remind: () => act('remind', {}),
    /** Who fills the other side; the route answers with its move when the new opponent owes one. */
    setOpponent: (opponent: Opponent) => act('opponent', { opponent }),
  }
}
