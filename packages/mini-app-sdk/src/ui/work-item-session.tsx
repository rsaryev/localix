import { createContext, useContext, type ReactNode } from 'react'

/**
 * The chat session a subtree BELONGS to — not the one the person happens to be looking at. The one
 * owner of that answer for the host and for mini apps: every editor-grid tab body is wrapped in it
 * (from the tab's scope), and so is every chat transcript (ChatSurface, a transcript view, a linked
 * call's preview), so a card, a code block or a mini app view inside one reads the chat it is in.
 *
 * The defect this exists to stop: a surface tied to one chat (a game board, a course) asked for
 * the ACTIVE session and acted on it. Kept mounted in the background after the person switched
 * chats, it then addressed the other chat: a board in chat A woke the agent in chat B. The SDK no
 * longer offers the active session at all; a session-scoped tab belongs to exactly one session for
 * its whole life, and the host says which here — the mini app never reads `item.scope` to guess.
 *
 * `null` for an app-level tab that belongs to no session, and outside a host provider.
 */
const WorkItemSessionContext = createContext<string | null>(null)

export function WorkItemSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string | null
  children: ReactNode
}) {
  return (
    <WorkItemSessionContext.Provider value={sessionId}>{children}</WorkItemSessionContext.Provider>
  )
}

/** The session this work item belongs to, or null for a global one. */
export function useWorkItemSessionId(): string | null {
  return useContext(WorkItemSessionContext)
}
