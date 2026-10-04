import { useCallback, useEffect, useState } from 'react'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'

import { owesAgentShot, playerViewSchema, type Player } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'
import { useStoreSnapshot } from '../useStoreSnapshot'

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

/** While the agent owes a shot and the feed is not live, how often the board looks for it. */
export const AGENT_TURN_POLL_MS = 800
export const IDLE_POLL_MS = 4000

export function useGame(active: boolean) {
  const sessionId = useWorkItemSessionId()
  const table = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const [quick, setQuick] = useState(false)
  const polled = useStoreSnapshot({
    plugin: 'battleship',
    sessionId,
    path: `${ROUTE_PATH}/game${table}`,
    schema: playerViewSchema,
    intervalMs: quick ? AGENT_TURN_POLL_MS : IDLE_POLL_MS,
    // A board that belongs to no chat has no game to read.
    active: active && sessionId !== null,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  useEffect(() => setQuick(owesAgentShot(polled.snapshot)), [polled.snapshot])

  const { send } = polled
  const act = useCallback(
    (action: string, body: object) => send(body, { path: `${ROUTE_PATH}/game/${action}${table}` }),
    [send, table],
  )

  return {
    ...polled,
    /** Whether this board belongs to a chat — a board opened outside one has no table. */
    hasTable: sessionId !== null,
    fire: (cell: number) => act('fire', { cell }),
    reshuffle: () => act('reshuffle', {}),
    newGame: (first?: Player) => act('new', first ? { first } : {}),
    remind: () => act('remind', {}),
  }
}

export type GameState = ReturnType<typeof useGame>
