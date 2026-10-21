import type { ParsedContextRef } from '@localixai/api/context-refs'
import type { ChatStore } from '../model/store'

type RefLabelState = Pick<ChatStore, 'sessions' | 'allSessions' | 'projects'>

function messagePreview(content: string | undefined): string | undefined {
  const text = (content ?? '').replace(/\s+/g, ' ').trim()
  return text ? (text.length > 48 ? `${text.slice(0, 48)}…` : text) : undefined
}

/** Primitive labels for only the refs rendered by one chip/pill surface. */
export function selectRefLabelValues(
  state: RefLabelState,
  refs: readonly ParsedContextRef[],
): (string | undefined)[] {
  return refs.map((ref) => {
    if (ref.kind === 'session' && ref.sessionId)
      return state.sessions.find((session) => session.id === ref.sessionId)?.title || undefined
    if (ref.kind === 'project' && ref.projectId)
      return state.projects.find((project) => project.id === ref.projectId)?.name || undefined
    if (ref.kind === 'message' && ref.sessionId && ref.messageId) {
      const message = state.allSessions
        .find((session) => session.id === ref.sessionId)
        ?.messages.find((item) => item.id === ref.messageId)
      return messagePreview(message?.content)
    }
    return undefined
  })
}
