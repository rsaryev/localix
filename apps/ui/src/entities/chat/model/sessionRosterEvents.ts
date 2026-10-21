import type { AgentStreamEvent } from '@/shared/api/contracts'
import { applyStreamEventToSession } from '@/shared/api/client'
import { toUiSessionSummary } from '@/shared/api/converters'
import type { ChatStore } from './store'
import {
  applyStreamEventPatch,
  clearLiveSessionBody,
  pruneFinishedSubSessions,
  patchSessionById,
  mergeSessionState,
} from './sessionListHelpers'

/** The common roster lifecycle for root chats, forks and workers, in every workspace. */
export function sessionRosterEventPatch(
  state: Pick<ChatStore, 'sessions' | 'allSessions' | 'activeSessionId' | 'activeProjectId'>,
  event: AgentStreamEvent,
): Partial<ChatStore> | null {
  if (event.type === 'session.deleted') {
    const removed = new Set(event.sessionIds)
    for (const id of removed) clearLiveSessionBody(id)
    return {
      allSessions: state.allSessions.filter((session) => !removed.has(session.id)),
      activeSessionId:
        state.activeSessionId && removed.has(state.activeSessionId) ? null : state.activeSessionId,
    }
  }
  if (event.type !== 'session.updated' && event.type !== 'child_session.updated') return null
  const summary = toUiSessionSummary(event.session)
  const exists = state.allSessions.some((session) => session.id === summary.id)
  if (!exists) return { allSessions: pruneFinishedSubSessions([summary, ...state.allSessions]) }
  if (event.type === 'child_session.updated') {
    const patch = patchSessionById(state, summary.id, (session) => ({
      ...applyStreamEventToSession(session, { type: 'session.updated', session: event.session }),
      // A worker's lifecycle snapshot is authoritative about completion; roots retain their
      // optimistic run flag until the separate run.completed/run.failed event.
      isRunning: summary.isRunning,
    }))
    const merged = mergeSessionState(state as ChatStore, patch)
    return { allSessions: pruneFinishedSubSessions(merged.allSessions ?? state.allSessions) }
  }
  // One metadata reducer, which preserves detail, optimistic sends and live-only fields.
  const patch = applyStreamEventPatch(state, summary.id, {
    type: 'session.updated',
    session: event.session,
  })
  return patch
}
