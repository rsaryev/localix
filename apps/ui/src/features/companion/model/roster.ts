import type { AttentionItem } from '@localixai/api/client'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import { toUiSessionSummary } from '@/shared/api/converters'
import { mergeSessionListSummary } from '@/features/chat/model/reconnect-session-list'
import { compareAttention } from '@/features/chat/model/attention/select'
import { attentionPolicyOf } from '@/features/chat/model/attention/policy'

/** A summary projection only: no transcript subscription, terminal, or editor side effects. */
export function applyCompanionEvent(
  sessions: readonly UiSession[],
  sessionId: string,
  event: AgentStreamEvent,
): readonly UiSession[] {
  if (event.type === 'session.deleted') {
    const removed = new Set(event.sessionIds)
    return sessions.filter((session) => !removed.has(session.id))
  }
  if (event.type === 'session.updated' || event.type === 'child_session.updated') {
    const summary = toUiSessionSummary(event.session)
    const current = sessions.find((session) => session.id === summary.id)
    return current
      ? sessions.map((session) =>
          session.id === summary.id ? mergeSessionListSummary(session, summary) : session,
        )
      : [summary, ...sessions]
  }
  if (
    event.type === 'run.started' ||
    event.type === 'run.completed' ||
    event.type === 'run.failed'
  ) {
    return sessions.map((session) =>
      session.id === sessionId ? { ...session, isRunning: event.type === 'run.started' } : session,
    )
  }
  return sessions
}

export function companionRoster(sessions: readonly UiSession[], items: readonly AttentionItem[]) {
  const waiting = items.filter((item) => attentionPolicyOf(item)).toSorted(compareAttention)
  const waitingIds = new Set(waiting.map((item) => item.sessionId))
  const working = sessions
    .filter((session) => session.isRunning && !waitingIds.has(session.id))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
  const recent = sessions
    .filter((session) => !session.isRunning && !session.isArchived && !waitingIds.has(session.id))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)
  return { waiting, working, recent }
}

const isRequest = (item: AttentionItem) => item.kind === 'interaction'

/** Requests the island can answer inline, in roster order. Plans and mentions open the chat. */
export function islandRequests(waiting: readonly AttentionItem[]) {
  return waiting.filter(isRequest)
}

/** The selected request first, then the quick chat's own, then the oldest waiting request. */
export function pendingRequest(
  requests: readonly AttentionItem[],
  selectedKey: string | null,
  quickSessionId: string | undefined,
) {
  return (
    requests.find((item) => item.key === selectedKey) ??
    requests.find((item) => item.sessionId === quickSessionId) ??
    requests[0]
  )
}

/** Cycle through waiting requests; a resolved current key restarts at the first one. */
export function nextRequest(requests: readonly AttentionItem[], currentKey: string) {
  const index = requests.findIndex((item) => item.key === currentKey)
  return requests[(index + 1) % requests.length]
}
