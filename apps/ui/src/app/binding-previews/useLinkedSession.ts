import { useEffect, useState } from 'react'
import type { AgentItem } from '@localixai/agent/agents'
import { createBoundedCache } from '@localixai/kit/lib'
import { useChatStore } from '@/features/chat/model/store'
import { backendClient } from '@/shared/api/client'
import type { Message, UiSession } from '@/shared/api/contracts'

/**
 * The conversation a link points into — a session, one of its messages, one of its tool calls —
 * for a preview drawn OUTSIDE the chat (a plugin's board, a card anywhere).
 *
 * The chat store holds only the sessions the person has opened; a link on a board usually points
 * at one they have not opened in this window. So the store is asked first, and otherwise the
 * session is read once from the server and kept for the next preview of the same session: a board
 * holding twelve calls from one conversation reads that conversation once, not twelve times. The
 * store is never written — a preview must not make a session look opened to the chat.
 *
 * A session is named by its id or by the `LOCALIX-<seq>` ref a person types, which the store
 * resolves through the session's sequence number.
 */
const read = createBoundedCache<string, Promise<UiSession | null>>({ maxEntries: 24 })

function fetchOnce(id: string): Promise<UiSession | null> {
  const known = read.get(id)
  if (known) return known
  const next = backendClient.getSession(id).catch(() => null)
  read.set(id, next)
  return next
}

const SEQ_REF = /^LOCALIX-(\d+)$/iu

/** The store's session for an id or a `LOCALIX-<seq>` ref, whether or not its body is loaded. */
export function useListedSession(ref: string | undefined): UiSession | undefined {
  return useChatStore((state) => {
    if (!ref) return undefined
    const seq = SEQ_REF.exec(ref)?.[1]
    const match = (session: UiSession) =>
      session.id === ref || (seq !== undefined && String(session.seq) === seq)
    return state.sessions.find(match) ?? state.allSessions.find(match)
  })
}

export type LinkedSession =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready'; session: UiSession }

/** The session WITH its messages: the store's when loaded, else one read from the server. */
export function useLinkedSession(ref: string | undefined): LinkedSession {
  const listed = useListedSession(ref)
  const loaded = listed && listed.bodyLoaded !== false ? listed : undefined
  const id = listed?.id ?? ref
  const [fetched, setFetched] = useState<{ id: string; session: UiSession | null } | null>(null)
  useEffect(() => {
    if (loaded || !id) return
    let live = true
    void fetchOnce(id).then((session) => {
      if (live) setFetched({ id, session })
    })
    return () => {
      live = false
    }
  }, [id, loaded])
  if (loaded) return { state: 'ready', session: loaded }
  if (!id) return { state: 'missing' }
  if (fetched?.id !== id) return { state: 'loading' }
  return fetched.session ? { state: 'ready', session: fetched.session } : { state: 'missing' }
}

/** The message holding a tool call (a call id may be given by a unique prefix, as `@call:` is). */
export function findToolCall(
  session: UiSession,
  toolCallId: string,
): { message: Message; item: AgentItem } | null {
  for (const message of session.messages)
    for (const item of message.items ?? [])
      if ('toolCallId' in item && typeof item.toolCallId === 'string')
        if (item.toolCallId === toolCallId || item.toolCallId.startsWith(toolCallId))
          return { message, item: item as AgentItem }
  return null
}

/**
 * Which loaded session holds a call, for a link that did not say (an older drag). `sessions` is
 * the current scope's view and changes with it, so the whole list is asked too.
 */
export function useSessionOfCall(toolCallId: string | undefined): string | undefined {
  return useChatStore((state) => {
    if (!toolCallId) return undefined
    const holds = (session: UiSession) => findToolCall(session, toolCallId) !== null
    return (state.sessions.find(holds) ?? state.allSessions.find(holds))?.id
  })
}
