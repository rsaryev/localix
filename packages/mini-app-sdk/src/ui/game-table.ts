import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'

import { useStoreSnapshot } from './store-snapshot'
import { useWorkItemSessionId } from './work-item-session'

/** While the other side owes a turn and the feed is not live, how often a board looks for it. */
export const AGENT_TURN_POLL_MS = 800
export const IDLE_POLL_MS = 4000

/**
 * A game board's state and the way it acts, for every game whose table is one chat.
 *
 * Every request names the chat the board BELONGS to (`useWorkItemSessionId`) — never the chat
 * that happens to be active. A board kept mounted in the background after the person switched
 * chats keeps reading and waking its own chat, not the one now on screen. The host checks the
 * session on every request, so a board whose chat was deleted reads nothing rather than a stale
 * game. The other side's turn arrives through its tool; the store feed nudges the board the
 * moment it lands (`useStoreSnapshot`). Only while that feed is not live does the board look for
 * itself — quickly while `quick` says the other side is playing, slowly otherwise.
 */
export function useTableGame<T>(options: {
  plugin: string
  /** The router's mount path, `/rpc/<plugin>`; the game is read at `<route>/game`. */
  route: string
  schema: z.ZodType<T>
  active: boolean
  quick: (snapshot: T | null) => boolean
  quickMs?: number
  failureMessage: string
}) {
  const { route, quick: quickWhen, quickMs = AGENT_TURN_POLL_MS } = options
  const sessionId = useWorkItemSessionId()
  const table = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const [quick, setQuick] = useState(false)
  const polled = useStoreSnapshot({
    plugin: options.plugin,
    sessionId,
    path: `${route}/game${table}`,
    schema: options.schema,
    intervalMs: quick ? quickMs : IDLE_POLL_MS,
    // A board that belongs to no chat has no game to read.
    active: options.active && sessionId !== null,
    failureMessage: options.failureMessage,
  })
  useEffect(() => setQuick(quickWhen(polled.snapshot)), [quickWhen, polled.snapshot])

  const { send } = polled
  /** POST `body` to `<route>/game/<action>`; the route answers with the new game. */
  const act = useCallback(
    (action: string, body: object) => send(body, { path: `${route}/game/${action}${table}` }),
    [send, route, table],
  )

  return {
    ...polled,
    /** Whether this board belongs to a chat — a board opened outside one has no table. */
    hasTable: sessionId !== null,
    act,
  }
}
