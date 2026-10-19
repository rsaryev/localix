import { useCallback, useEffect, useState } from 'react'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'

import {
  playerViewSchema,
  viewOwesAgentMove,
  type Move,
  type Opponent,
  type Player,
} from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'
import { useStoreSnapshot } from '../useStoreSnapshot'

/**
 * The table as the person may see it, and the four things they can do at it.
 *
 * Every request names the chat the table BELONGS to (`useWorkItemSessionId`), never the active
 * one. The routes answer with the person's view only — the agent's sealed move arrives as its
 * digest. The store feed nudges the table the moment the agent's move lands; only while that feed
 * is not live does the table poll — quickly while the agent owes a move, slowly otherwise.
 */

export const AGENT_TURN_POLL_MS = 800
export const IDLE_POLL_MS = 4000

export function useGame(active: boolean) {
  const sessionId = useWorkItemSessionId()
  const table = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const [quick, setQuick] = useState(false)
  const polled = useStoreSnapshot({
    plugin: 'rock-paper-scissors',
    sessionId,
    path: `${ROUTE_PATH}/game${table}`,
    schema: playerViewSchema,
    intervalMs: quick ? AGENT_TURN_POLL_MS : IDLE_POLL_MS,
    active: active && sessionId !== null,
    failureMessage: 'The table could not be read. Check that Localix is running, then retry.',
  })
  useEffect(() => setQuick(viewOwesAgentMove(polled.snapshot)), [polled.snapshot])

  const { send } = polled
  const act = useCallback(
    (action: string, body: object) => send(body, { path: `${ROUTE_PATH}/game/${action}${table}` }),
    [send, table],
  )

  return {
    ...polled,
    /** Whether this table belongs to a chat — one opened outside a chat has none. */
    hasTable: sessionId !== null,
    play: (move: Move) => act('play', { move }),
    nextRound: (first?: Player) => act('next', first ? { first } : {}),
    remind: () => act('remind', {}),
    /** Who fills the other seat; the route answers with its move when the new opponent owes one. */
    setOpponent: (opponent: Opponent) => act('opponent', { opponent }),
  }
}
