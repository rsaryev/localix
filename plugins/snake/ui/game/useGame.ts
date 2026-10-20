import { useCallback, useEffect, useState } from 'react'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'

import { gameSchema, modelPlays, type Direction, type Mode } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'
import { useStoreSnapshot } from '../useStoreSnapshot'

/**
 * The stored board and the things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`), never the chat that
 * happens to be active. The model's moves land through the store feed (`useStoreSnapshot`); only
 * while that feed is not live does the board look for itself — quickly while the model plays.
 */

/** While the model plays and the feed is not live, how often the board looks for its moves. */
export const MODEL_PLAY_POLL_MS = 400
export const IDLE_POLL_MS = 4000

export function useGame(active: boolean) {
  const sessionId = useWorkItemSessionId()
  const table = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const [quick, setQuick] = useState(false)
  const polled = useStoreSnapshot({
    plugin: 'snake',
    sessionId,
    path: `${ROUTE_PATH}/game${table}`,
    schema: gameSchema,
    intervalMs: quick ? MODEL_PLAY_POLL_MS : IDLE_POLL_MS,
    active: active && sessionId !== null,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  useEffect(() => setQuick(modelPlays(polled.snapshot)), [polled.snapshot])

  const { send } = polled
  const act = useCallback(
    (action: string, body: object) => send(body, { path: `${ROUTE_PATH}/game/${action}${table}` }),
    [send, table],
  )
  const saveTurns = useCallback(
    (fromTick: number, headings: readonly Direction[]) => act('turns', { fromTick, headings }),
    [act],
  )

  return {
    ...polled,
    /** Whether this board belongs to a chat — a board opened outside one has no table. */
    hasTable: sessionId !== null,
    saveTurns,
    newGame: (mode: Mode) => act('new', { mode }),
    setMode: (mode: Mode) => act('mode', { mode }),
    remind: () => act('remind', {}),
    stop: () => act('stop', {}),
  }
}
