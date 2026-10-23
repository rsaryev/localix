import { useCallback } from 'react'
import { useTableGame } from '@localixai/mini-app-sdk/ui/game-table'

import { agentPlays, gameSchema, type Direction, type Mode, type Opponent } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'

/**
 * The board's state and the things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`) — never the chat
 * that happens to be active. The agent's moves arrive through its tool; the store feed nudges the
 * board the moment they land (`useStoreSnapshot`). Only while that feed is not live does the board
 * look for itself — quickly while the agent plays, slowly otherwise.
 */

export function useGame(active: boolean) {
  const game = useTableGame({
    miniApp: 'game-2048',
    route: ROUTE_PATH,
    schema: gameSchema,
    active,
    quick: agentPlays,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  const { act } = game
  const play = useCallback((direction: Direction) => act('move', { direction }), [act])

  return {
    ...game,
    play,
    newGame: (mode: Mode) => act('new', { mode }),
    setMode: (mode: Mode) => act('mode', { mode }),
    remind: () => act('remind', {}),
    /** Pause whoever plays the board until Continue. */
    stop: () => act('stop', {}),
    /** Who plays the board while the person watches. */
    setOpponent: (opponent: Opponent) => act('opponent', { opponent }),
  }
}
