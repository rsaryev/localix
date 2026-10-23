import { useCallback } from 'react'
import { useTableGame } from '@localixai/mini-app-sdk/ui/game-table'

import { gameSchema, modelPlays, type Direction, type Mode } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'

/**
 * The stored board and the things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`), never the chat that
 * happens to be active. The model's moves land through the store feed (`useStoreSnapshot`); only
 * while that feed is not live does the board look for itself — quickly while the model plays.
 */

/** While the model plays and the feed is not live, how often the board looks for its moves. */
export const MODEL_PLAY_POLL_MS = 400

export function useGame(active: boolean) {
  const game = useTableGame({
    miniApp: 'snake',
    route: ROUTE_PATH,
    schema: gameSchema,
    active,
    quick: modelPlays,
    quickMs: MODEL_PLAY_POLL_MS,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  const { act } = game
  const saveTurns = useCallback(
    (fromTick: number, headings: readonly Direction[]) => act('turns', { fromTick, headings }),
    [act],
  )

  return {
    ...game,
    saveTurns,
    newGame: (mode: Mode) => act('new', { mode }),
    setMode: (mode: Mode) => act('mode', { mode }),
    remind: () => act('remind', {}),
    stop: () => act('stop', {}),
  }
}
