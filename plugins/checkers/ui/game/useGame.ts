import { useCallback, useEffect, useState } from 'react'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'

import { gameSchema, owesAgentMove, type Opponent, type Side } from '../../shared/game'
import { ROUTE_PATH } from '../../shared/resource'
import { useStoreSnapshot } from '../useStoreSnapshot'

/**
 * The board's state and the three things a person can do to it.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`) — never the chat
 * that happens to be active. A board kept mounted in the background after the person switched
 * chats keeps reading and waking its own chat, not the one now on screen. The host checks the
 * session on every request, so a board whose chat was deleted reads nothing rather than a stale
 * game. The agent's own move arrives through its tool; the store feed nudges the board the moment
 * it lands (`useStoreSnapshot`). Only while that feed is not live does the board look for itself —
 * quickly while the agent owes a move, slowly otherwise.
 */

/** While the agent owes a move and the feed is not live, how often the board looks for it. */
export const AGENT_TURN_POLL_MS = 800
export const IDLE_POLL_MS = 4000

export function useGame(active: boolean) {
  const sessionId = useWorkItemSessionId()
  const table = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const [quick, setQuick] = useState(false)
  const polled = useStoreSnapshot({
    plugin: 'checkers',
    sessionId,
    path: `${ROUTE_PATH}/game${table}`,
    schema: gameSchema,
    intervalMs: quick ? AGENT_TURN_POLL_MS : IDLE_POLL_MS,
    // A board that belongs to no chat has no game to read.
    active: active && sessionId !== null,
    failureMessage: 'The board could not be read. Check that Localix is running, then retry.',
  })
  useEffect(() => setQuick(owesAgentMove(polled.snapshot)), [polled.snapshot])

  const { send } = polled
  const act = useCallback(
    (action: string, body: object) => send(body, { path: `${ROUTE_PATH}/game/${action}${table}` }),
    [send, table],
  )

  return {
    ...polled,
    /** Whether this board belongs to a chat — a board opened outside one has no table. */
    hasTable: sessionId !== null,
    play: (squares: number[]) => act('move', { squares }),
    newGame: (you?: Side) => act('new', you ? { you } : {}),
    remind: () => act('remind', {}),
    /** Who plays the other colour; the route answers with its move when the new opponent owes one. */
    setOpponent: (opponent: Opponent) => act('opponent', { opponent }),
  }
}
