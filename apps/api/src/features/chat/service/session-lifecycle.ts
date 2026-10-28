import { ConflictError, InvalidRequestError } from '../../../lib/domain-errors'
import { announceSessionChanges } from '../runtime/session-notice'
import { sessionFieldsPatch } from './session-patch'
import { toSessionSummary } from '../repository'
import type { SessionDetail, SessionSummary } from '../contracts'
import { assertRoutePatch, clampRoutePatch, writeRoutePatch } from './session-route-patch'
import type { SessionLifecycleCtx, UpdateSessionPatch } from './session-lifecycle-contracts'
import {
  announceCwdChange,
  announceModelSwitches,
  guardModelSwitches,
  modelSwitches,
} from './cc-session-events'

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
      throw new InvalidRequestError(
        'not_chat_session',
        'Only an ordinary chat can have a linked agent.',
      )
    if (
      session.externalAgentProvider &&
      session.externalAgentProvider !== patch.externalAgentProvider
    )
      throw new ConflictError('agent_already_linked', 'This chat already has a linked agent.')
  }
  await assertRoutePatch(ctx, userId, patch)
  // CC PreModelSwitch may refuse the picker's switch before anything is written.
  const switches = modelSwitches(session.agent, patch.route)
  await guardModelSwitches(ctx.ccHookSessions, id, switches, 'picker')
  const moved = patch.projectId !== undefined && patch.projectId !== session.projectId
  const cwdBefore = moved ? await ctx.resolveSessionWorkingDir?.(userId, session) : undefined
  // A child runs under its root's mode, so a mode set on the child alone would be overwritten by
  // the root's next change and, until then, make one worker in a plan conversation able to write.
  if (patch.permissionMode !== undefined && session.parentSessionId !== null) {
    throw new ConflictError(
      'permission_mode_owned_by_root',
      "A delegated session runs under its root conversation's mode; change it there",
    )
  }
  // Claude Code's `disableBypassPermissionsMode` keeps the folder out of the modes that stop asking.
  if (
    (patch.permissionMode === 'bypass' || patch.permissionMode === 'autonomous') &&
    ctx.claudeCodeModes &&
    ctx.resolveSessionWorkingDir
  ) {
    const modes = await ctx.claudeCodeModes(await ctx.resolveSessionWorkingDir(userId, session))
    if (modes.bypassDisabled)
      throw new ConflictError(
        'bypass_disabled',
        "Claude Code's settings for this folder disable bypass mode (disableBypassPermissionsMode)",
      )
  }
  // The session's own fields — only the ones this patch names.
  const fields = sessionFieldsPatch(session, patch, ctx.now)
  if (fields) await ctx.repo.updateSession(userId, id, fields)
  // A re-route is its own statement: nothing above writes what the agent runs on, because the
  // records it reads carry routes the chain RESOLVED, not routes anyone chose.
  await writeRoutePatch(ctx, userId, id, await clampRoutePatch(ctx, userId, session, patch))
  // Read back what was stored, resolved.
  const persisted = await ctx.requireSession(userId, id)
  // What the agent now runs on, said in the conversation. AFTER the write is durable, so a failed
  // edit never announces a change that did not happen.
  await announceSessionChanges(ctx, userId, id, session, persisted)
  const modeBefore = session.permissionMode
  if (persisted.permissionMode !== undefined && persisted.permissionMode !== modeBefore)
    await ctx.onPermissionModeChanged?.(userId, id, modeBefore, persisted.permissionMode)
  announceModelSwitches(ctx.ccHookSessions, id, switches, 'picker')
  if (cwdBefore !== undefined) {
    const cwdAfter = await ctx.resolveSessionWorkingDir?.(userId, persisted)
    if (cwdAfter !== undefined) announceCwdChange(ctx.ccHookSessions, id, cwdBefore, cwdAfter)
  }
  ctx.publishSession(persisted)
  return ctx.getSessionDetail(userId, id)
}
