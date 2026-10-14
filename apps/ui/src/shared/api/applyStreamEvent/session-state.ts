/**
 * The session's own metadata and its panels. Each panel frame (`session_*.updated`, `lsp.*`) is
 * a last-wins snapshot of one field, so its handler replaces that field and nothing else.
 */
import { withModelViewDivider } from '../modelViewDivider'
import type { StreamReducers } from './types'

export const sessionStateReducers: StreamReducers<
  | 'session.updated'
  | 'session_timing.updated'
  | 'session_usage.updated'
  | 'session_triggers.updated'
  | 'session_work.updated'
  | 'session_questions.updated'
  | 'plan.updated'
  | 'session_resume.updated'
  | 'session_queue.updated'
  | 'session_permissions.updated'
  | 'session_model_view.updated'
  | 'lsp.status'
  | 'lsp.diagnostics'
> = {
  'session.updated': (session, event) => {
    if (event.session.id !== session.id) return session
    return {
      ...session,
      title: event.session.title,
      externalAgentProvider: event.session.externalAgentProvider,
      externalAgentSessionKey: event.session.externalAgentSessionKey,
      isPinned: event.session.isPinned,
      isArchived: event.session.isArchived,
      agents: event.session.agents,
      rosterLocked: event.session.rosterLocked,
      // An approved plan switches the mode on the server; without this the composer kept
      // showing Plan until the next reload.
      permissionMode: event.session.permissionMode,
      description: event.session.description,
      avatar: event.session.avatar,
      projectId: event.session.projectId,
      parentSessionId: event.session.parentSessionId,
      rootSessionId: event.session.rootSessionId,
      sessionKind: event.session.sessionKind,
      runtimeStatus: event.session.runtimeStatus,
      sourceToolCallId: event.session.sourceToolCallId,
      messageCount: event.session.messageCount ?? session.messageCount,
      closedAt: event.session.closedAt ?? null,
      // session.updated carries general metadata and can arrive BEFORE run.started
      // (e.g. title generation on the first message), when runtimeStatus isn't yet
      // 'running' — so it must never clear the optimistic run flag. The falling edge
      // is owned by run.completed/run.failed; here we only promote to running.
      isRunning: event.session.runtimeStatus === 'running' ? true : session.isRunning,
      updatedAt: Date.parse(event.session.updatedAt),
      revision: event.session.updatedAt,
      pinnedSkills: event.session.pinnedSkills ?? session.pinnedSkills,
    }
  },
  'session_timing.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, sessionTiming: event.timing } : session,
  'session_usage.updated': (session, event) =>
    event.sessionId === session.id
      ? { ...session, sessionUsage: event.usage ?? undefined }
      : session,
  'session_triggers.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, loops: event.loops } : session,
  // The full set of running work, last-wins — what the composer's work strip renders. A
  // monitor's latest event arrives here too: it is a field of its work record.
  'session_work.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, work: event.work } : session,
  // The open queued questions, last-wins — the composer's questions strip and the sidebar mark.
  'session_questions.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, questions: event.questions } : session,
  // Every version of the conversation's plan, last-wins — the plan view and its versions diff.
  'plan.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, plans: event.plans } : session,
  'session_resume.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, resumePoints: event.points } : session,
  // Queue removal is ambiguous: it can mean explicit cancellation OR that the runner leased
  // the row and is about to persist its message. Never erase the visible optimistic turn here;
  // explicit UI cancellation owns that cleanup, while message.created claims a delivered row
  // in place.
  'session_queue.updated': (session, event) =>
    event.sessionId === session.id ? { ...session, queuedMessages: event.queue } : session,
  'session_permissions.updated': (session, event) =>
    event.sessionId === session.id
      ? { ...session, autoApprovedTools: event.autoApprovedTools }
      : session,
  // A checkpoint moved where the agent's view begins; the divider moves with it.
  'session_model_view.updated': (session, event) =>
    event.sessionId === session.id
      ? { ...session, messages: withModelViewDivider(session.messages, event.modelView) }
      : session,
  'lsp.status': (session, event) =>
    event.sessionId === session.id ? { ...session, lspServers: event.servers } : session,
  'lsp.diagnostics': (session, event) =>
    event.sessionId === session.id
      ? {
          ...session,
          lspDiagnostics: { ...session.lspDiagnostics, [event.file]: event.diagnostics },
        }
      : session,
}
