import { ApiError } from '../../../lib/errors'
import { hasConversationStarted } from '../roster-lock'
import { recordSessionChanges } from '../runtime/session-notice'
import { changeParticipants } from '../runtime/conversation-participants'
import { sessionFieldsPatch } from './session-patch'
import { reseatParticipants } from './participant-routes'
import { resolveSessionParticipants } from './session-agent-selection'
import { toSessionSummary } from '../repository'
import type { SessionDetail, SessionSummary } from '../contracts'
import { sessionRoute } from '../session-route'
import type { SessionLifecycleCtx, UpdateSessionPatch } from './session-lifecycle-contracts'

export { deleteSession } from './session-deletion'
export type {
  SessionLifecycleCtx,
  CreateSessionInput,
  UpdateSessionPatch,
} from './session-lifecycle-contracts'

export async function listSessions(
  ctx: SessionLifecycleCtx,
  userId: string,
): Promise<{ sessions: SessionSummary[] }> {
  const [sessions, previews] = await Promise.all([
    ctx.repo.listSessions(userId),
    ctx.repo.lastMessagesByUser(userId),
  ])
  return {
    sessions: sessions.map((session) => ({
      ...toSessionSummary(session),
      messageCount: session.messageCount ?? 0,
      ...(previews.get(session.id) ? { lastMessage: previews.get(session.id) } : {}),
    })),
  }
}

// The birth of a session is its own module (`session-birth.ts`): it decides what a conversation
// IS, where everything below acts on one that already exists. Re-exported so the service keeps
// one import for the lifecycle.
export { createSession } from './session-birth'
export async function updateSession(
  ctx: SessionLifecycleCtx,
  userId: string,
  id: string,
  patch: UpdateSessionPatch,
): Promise<SessionDetail> {
  const session = await ctx.requireSession(userId, id)
  if (patch.externalAgentProvider !== undefined) {
    if (session.sessionKind !== 'chat')
      throw new ApiError(400, 'not_chat_session', 'Only an ordinary chat can have a linked agent.')
    if (
      session.externalAgentProvider &&
      session.externalAgentProvider !== patch.externalAgentProvider
    )
      throw new ApiError(409, 'agent_already_linked', 'This chat already has a linked agent.')
  }
  if (patch.route?.providerConnectionId && ctx.connectionExists) {
    if (!(await ctx.connectionExists(userId, patch.route.providerConnectionId))) {
      throw new ApiError(
        404,
        'provider_connection_not_found',
        'That provider connection no longer exists. Pick a provider in the model picker.',
      )
    }
  }
  if (
    patch.route?.agentId &&
    !session.agents.some((agent) => agent.agentId === patch.route?.agentId)
  ) {
    throw new ApiError(404, 'agent_unavailable', 'Selected agent is no longer a participant')
  }
  // A child runs under its root's mode, so a mode set on the child alone would be overwritten by
  // the root's next change and, until then, make one worker in a plan conversation able to write.
  if (patch.permissionMode !== undefined && session.parentSessionId !== null) {
    throw new ApiError(
      409,
      'permission_mode_owned_by_root',
      "A delegated session runs under its root conversation's mode; change it there",
    )
  }
  // Refused BEFORE anything is written, so a patch that also names a title or a roster cannot
  // half-apply around a lock it was not allowed to change.
  if (patch.rosterLocked !== undefined && patch.rosterLocked !== session.rosterLocked) {
    const messages = await ctx.repo.listMessages(userId, id)
    if (hasConversationStarted(messages.map((message) => message.payload)))
      throw new ApiError(
        409,
        'conversation_started',
        'Participants can be fixed or opened only before the conversation starts',
      )
  }
  // WHO is in the conversation: the one participants writer, which guards the active speaker,
  // refuses a stale list, cancels the leavers' queued turns and announces the change.
  let afterMembership = session
  if (patch.agents !== undefined) {
    const requested = patch.agents
    const change = await changeParticipants(ctx, {
      userId,
      sessionId: id,
      ...(patch.expectedUpdatedAt !== undefined
        ? { expectedUpdatedAt: patch.expectedUpdatedAt }
        : {}),
      decide: async (current) =>
        reseatParticipants(
          { ...current, userId, projectId: patch.projectId ?? current.projectId },
          await resolveSessionParticipants({
            userId,
            projectId: patch.projectId ?? current.projectId,
            requested,
            existing: current.agents,
            resolve: ctx.resolveSessionAgent,
            ...(current.sessionKind === 'chat' ? { host: 'chat' } : {}),
          }),
          ctx.seatRoute,
        ),
    })
    afterMembership = change.after
  }
  // The session's own fields — only the ones this patch names.
  const fields = sessionFieldsPatch(session, patch, ctx.now)
  if (fields) await ctx.repo.updateSession(userId, id, fields)
  // A re-route is its own statement: nothing above writes what a participant runs on — the
  // records it reads carry routes the chain RESOLVED, not routes anyone chose.
  if (patch.route) {
    const target = patch.route.agentId ?? sessionRoute(session).agentId
    await ctx.repo.updateSessionAgentRoute(userId, id, target, patch.route)
  }
  // Read back what was stored, resolved: a newcomer's route is blank on purpose, and publishing
  // the in-memory record would show it with no model until the next read.
  const persisted = await ctx.requireSession(userId, id)
  // What the people who stayed now run on, said in the conversation. The membership lines were
  // already written by the participants writer, so this diff starts from its result. AFTER the
  // write is durable, so a failed edit never announces a change that did not happen.
  await recordSessionChanges(ctx, userId, id, afterMembership, persisted)
  const modeBefore = afterMembership.permissionMode
  if (persisted.permissionMode !== undefined && persisted.permissionMode !== modeBefore)
    await ctx.onPermissionModeChanged?.(userId, id, modeBefore, persisted.permissionMode)
  ctx.publishSession(persisted)
  return ctx.getSessionDetail(userId, id)
}
