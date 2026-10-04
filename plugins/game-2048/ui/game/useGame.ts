import { useCallback, useEffect, useState } from 'react'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'

import { agentPlays, gameSchema, type Direction, type Mode } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'
import { useStoreSnapshot } from '../useStoreSnapshot'

/**
 * The board's state and the things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`) — never the chat
 * that happens to be active. The agent's moves arrive through its tool; the store feed nudges the
 * board the moment they land (`useStoreSnapshot`). Only while that feed is not live does the board
 * look for itself — quickly while the agent plays, slowly otherwise.
 */

/** While the agent plays and the feed is not live, how often the board looks for its moves. */
export const AGENT_PLAY_POLL_MS = 800
export const IDLE_POLL_MS = 4000

export function useGame(active: boolean) {
  const sessionId = useWorkItemSessionId()
  const table = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const [quick, setQuick] = useState(false)
  const polled = useStoreSnapshot({
    plugin: 'game-2048',
    sessionId,
    path: `${ROUTE_PATH}/game${table}`,
    schema: gameSchema,
    intervalMs: quick ? AGENT_PLAY_POLL_MS : IDLE_POLL_MS,
    // A board that belongs to no chat has no game to read.
    active: active && sessionId !== null,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  useEffect(() => setQuick(agentPlays(polled.snapshot)), [polled.snapshot])

  const { send } = polled
  const act = useCallback(
    (action: string, body: object) => send(body, { path: `${ROUTE_PATH}/game/${action}${table}` }),
    [send, table],
  )
  const play = useCallback((direction: Direction) => act('move', { direction }), [act])

  return {
    ...polled,
    /** Whether this board belongs to a chat — a board opened outside one has no table. */
    hasTable: sessionId !== null,
    play,
    newGame: (mode: Mode) => act('new', { mode }),
    setMode: (mode: Mode) => act('mode', { mode }),
    remind: () => act('remind', {}),
  }
}

export type GameState = ReturnType<typeof useGame>
