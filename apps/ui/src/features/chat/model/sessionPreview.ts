import { isMultiParticipant, type UiSession } from '@/shared/api/contracts'
import { agentAuthorId } from '@/shared/contrib/useAgentIdentity'

/**
 * The second line of a dialog row: what was last said in the conversation.
 *
 * A live run is deliberately NOT one of the sources here. It is a leading mark on the title
 * line instead, because a run in this slot both read as something the agent had said and
 * cost the row a second line that rows without one did not have. What is left is one line
 * with one truth; an unsent draft, once drafts are persisted per session, would compete
 * with the message for it.
 *
 * The author is part of the answer, not decoration. Naming who spoke is the difference
 * between a list of chats and a list of titles, and it is what a session with several
 * agents needs — a transport role cannot say it, since every agent's line is `assistant`.
 */
export type SessionPreviewKind = 'message' | 'empty'

export interface SessionPreview {
  kind: SessionPreviewKind
  /** What to print before the text, already worded ('You', '@reviewer'). */
  author?: string
  /** The handle behind the author, so the row can tint it with that agent's own colour. */
  authorHandle?: string
  text: string
}

const EMPTY: SessionPreview = { kind: 'empty', text: '' }

/**
 * Whether the row should name the speaker at all.
 *
 * In a private chat an agent's own line needs no prefix: there is only one voice it could
 * be, and printing it on every row is noise. The user's own line is always named, because
 * "You: …" is the signal that nobody has answered yet. A party of two or more names
 * everyone — that is the whole reason the author travels with the preview.
 */
function shouldName(session: UiSession, isUser: boolean): boolean {
  return isUser || isMultiParticipant(session)
}

export function sessionPreview(session: UiSession): SessionPreview {
  const last = session.lastMessage
  if (!last?.text) return EMPTY

  const agentId = agentAuthorId(last.from)
  const handle =
    last.authorSnapshot?.handle ??
    session.agents.find((agent) => agent.agentId === agentId)?.handle ??
    agentId
  const isUser = last.from === 'user'
  if (!shouldName(session, isUser)) return { kind: 'message', text: last.text }
  return {
    kind: 'message',
    text: last.text,
    ...(isUser ? { author: 'You' } : handle ? { author: `@${handle}`, authorHandle: handle } : {}),
  }
}
