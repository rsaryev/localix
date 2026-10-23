import { useTableGame } from '@localixai/mini-app-sdk/ui/game-table'

import { owesAgentShot, playerViewSchema, type Opponent, type Player } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'

/**
 * The board's state and the four things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`) — never the chat
 * that happens to be active. A board kept mounted in the background after the person switched
 * chats keeps reading and waking its own chat, not the one now on screen. The host checks the
 * session on every request, so a board whose chat was deleted reads nothing rather than a stale
 * game. What arrives is the person's VIEW — the agent's fleet is never sent to the browser, which
 * is why the store feed only nudges and the board re-reads its view through the route. The
 * agent's shot arrives through its tool, and the nudge comes the moment it lands
 * (`useStoreSnapshot`); only while that feed is not live does the board look for itself.
 */

export function useGame(active: boolean) {
  const game = useTableGame({
    miniApp: 'battleship',
    route: ROUTE_PATH,
    schema: playerViewSchema,
    active,
    quick: owesAgentShot,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  const { act } = game

  return {
    ...game,
    fire: (cell: number) => act('fire', { cell }),
    reshuffle: () => act('reshuffle', {}),
    newGame: (first?: Player) => act('new', first ? { first } : {}),
    remind: () => act('remind', {}),
    /** Who fires from the agent's side; the route answers after its shots when it owes one. */
    setOpponent: (opponent: Opponent) => act('opponent', { opponent }),
  }
}
