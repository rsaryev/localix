import { ApiError } from '../../../lib/errors'
import { hasConversationStarted } from '../roster-lock'
import { recordSessionChanges } from '../runtime/session-notice'
import { changeParticipants } from '../runtime/conversation-participants'
import { sessionFieldsPatch } from './session-patch'
import { reseatParticipants } from './participant-routes'
import {
  resolveSessionParticipants,
  type ResolveSessionAgent,
  type SessionAgentSelection,
} from './session-agent-selection'
import type { AgentSessionKind, ReasoningEffort } from '../../../db/types'
import type { PermissionMode } from '../../capabilities/permission-modes'
import type { LastMessagePreview, ModelRoute } from '../repository-types'
import type { SessionDeletionContext } from './session-deletion'
export { deleteSession } from './session-deletion'
import { toSessionSummary, type SessionRecord } from '../repository'
import type {
  AgentStreamEvent,
  PersistedMessage,
  SessionDetail,
  SessionSummary,
} from '../contracts'
import type { SessionProvenance } from '../session-provenance'
import { sessionRoute } from '../session-route'

type RuntimeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'

/** Closure values the session-lifecycle operations need from createChatService. */
export interface SessionLifecycleCtx extends Omit<SessionDeletionContext, 'repo'> {
  activeAgentId?: (sessionId: string) => string | undefined
  cancelAgentTurn?: (userId: string, sessionId: string, agentId: string) => Promise<void>
  resolveSessionAgent?: ResolveSessionAgent
  repo: SessionDeletionContext['repo'] & {
    listSessions: (userId: string) => Promise<SessionRecord[]>
    listSessionAncestry: (userId: string, id: string) => Promise<SessionRecord[]>
    countMessagesByUser: (userId: string) => Promise<Map<string, number>>
    lastMessagesByUser: (userId: string) => Promise<Map<string, LastMessagePreview>>
    allocateSessionRef: (userId: string) => Promise<{ seq: number; id: string }>
    insertSession: (session: SessionRecord) => Promise<void>
    getSession: (userId: string, id: string) => Promise<SessionRecord | null>
    /** The session's own fields; only the keys present are written. */
    updateSession: (userId: string, id: string, patch: Partial<SessionRecord>) => Promise<void>
    /** WHO is in the conversation, compare-and-set (see `changeParticipants`). */
    updateMembership: (
      userId: string,
      id: string,
      agents: SessionRecord['agents'],
      stamp: { updatedAt: string; expectedUpdatedAt?: string },
    ) => Promise<boolean>
    /** A deliberate re-route of ONE participant — the only write that touches a seat's route. */
    updateSessionAgentRoute: (
      userId: string,
      id: string,
      agentId: string,
      route: Partial<ModelRoute>,
    ) => Promise<void>
    /** For the membership line a party edit writes into the conversation. */
    insertMessage: (message: PersistedMessage) => Promise<void>
    /** Whether the conversation has started, which settles `rosterLocked`. */
    listMessages: (userId: string, sessionId: string) => Promise<PersistedMessage[]>
  }
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  now: () => string
  /**
   * The reasoning effort a new seat is born with, decided by the model chain. Only the EFFORT:
   * a seat's model is left blank so the chain answers for it on every read
   * (`session-route-defaults.ts`). Absent — an isolated host — means the flat default.
   */
  seatEffort?: (userId: string, projectId: string, agentId: string) => Promise<ReasoningEffort>
  /**
   * The project a session with no explicit one belongs to (see `projects/default-project.ts`).
   *
   * A port rather than a direct call so this module stays chat-shaped, and REQUIRED because
   * `SessionRecord.projectId` is not nullable: a host that could not name a project would be
   * creating a session whose capability scope is the installation ceiling, which is the exact
   * conflation the default project exists to end.
   */
  resolveDefaultProjectId: (userId: string) => Promise<string>
  /**
   * Does this user hold this provider connection?
   *
   * A stated connection is a FOREIGN KEY into `provider_connections`, and an id that resolves to
   * nothing used to reach the insert and surface as `500 Unexpected server error` — the shape a
   * recreated database produced for every client still naming a connection from the old one.
   * A caller that names something that does not exist has made a request error, and the answer
   * has to say so. Optional: a host that wires no connections (a narrow test) cannot refuse an
   * id it has no way to check, and refusing on a missing port would fail conversations for a
   * reason that is the host's, not the caller's.
   */
  connectionExists?: (userId: string, connectionId: string) => Promise<boolean>
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  getSessionDetail: (userId: string, id: string) => Promise<SessionDetail>
  publishSession: (session: SessionRecord) => void
  /**
   * The root's permission mode moved — after the write and its notice. A port, not an import:
   * what a mode change means for the conversation's plan (a version waiting for review is set
   * aside when the conversation leaves plan mode) is `features/plans`', which already depends on
   * chat. Awaited, so the plan's own line lands right after the mode line it follows from.
   */
  onPermissionModeChanged?: (
    userId: string,
    sessionId: string,
    before: PermissionMode | undefined,
    after: PermissionMode,
  ) => Promise<void>
}

export interface CreateSessionInput {
  title?: string
  providerConnectionId?: string | null
  modelId?: string
  reasoningEffort?: ReasoningEffort
  projectId?: string
  parentSessionId?: string | null
  rootSessionId?: string | null
  /**
   * chat = user-editable conversation/fork/message thread;
   * subagent/job = actively running child work;
   * system = passive append-only log, never an agent-loop target.
   */
  sessionKind?: AgentSessionKind
  sourceToolCallId?: string | null
  /** Trusted internal creator metadata. Public routes never accept this field. */
  provenance?: SessionProvenance
  /** Skills to preload into context (CC agent `skills:` frontmatter). */
  pinnedSkills?: string[]
  /**
   * Who this conversation is with, in join order. Omitted = the default agent, which is what
   * an ordinary chat gets: a session is never with no one. Several make it a group.
   *
   * Each entry may carry its own route. A caller that has resolved an agent's registry record
   * passes its preferred model here; one that has not passes the handle alone and every
   * participant is seeded from the same session-level fallback.
   */
  agents?: Array<SessionAgentSelection & Partial<ModelRoute>>
  /** A group's own description. Ignored for a private chat, which describes its agent. */
  description?: string | null
  /** A group's avatar ref; omitted = generated from the title. */
  avatar?: string | null
}

export interface UpdateSessionPatch {
  title?: string
  /** The conversation's permission mode — a root's only; written to its whole tree. */
  permissionMode?: PermissionMode
  /**
   * Re-route ONE participant — a model belongs to an agent inside a conversation, not to the
   * conversation. Omitting the id means the session's own participant: the only one in a private
   * chat, the first in a group.
   */
  route?: { agentId?: string } & Partial<ModelRoute>
  isPinned?: boolean
  isArchived?: boolean
  /** Move the session to another project. Never null — a session always belongs to one. */
  projectId?: string
  runtimeStatus?: RuntimeStatus
  /** Adding or removing participants. Never empty — a session is always with someone. */
  agents?: Array<SessionAgentSelection & Partial<ModelRoute>>
  /**
   * The session's `updatedAt` the editor was looking at. With `agents`, a newer session refuses
   * the change (409) instead of erasing whatever changed in between.
   */
  expectedUpdatedAt?: string
  /** Fix or open the participants; only before the conversation starts (`roster-lock.ts`). */
  rosterLocked?: boolean
  /** Only a group carries these; a private chat renders its agent instead. The kind itself is
   *  not patchable: it follows the party (see `updateSession`). */
  description?: string | null
  avatar?: string | null
}

export async function listSessions(
  ctx: SessionLifecycleCtx,
  userId: string,
): Promise<{ sessions: SessionSummary[] }> {
  const [sessions, counts, previews] = await Promise.all([
    ctx.repo.listSessions(userId),
    ctx.repo.countMessagesByUser(userId),
    ctx.repo.lastMessagesByUser(userId),
  ])
  return {
    sessions: sessions.map((session) => ({
      ...toSessionSummary(session),
      messageCount: counts.get(session.id) ?? 0,
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
          current,
          await resolveSessionParticipants({
            userId,
            projectId: patch.projectId ?? current.projectId,
            requested,
            existing: current.agents,
            resolve: ctx.resolveSessionAgent,
            ...(current.sessionKind === 'chat' ? { host: 'chat' } : {}),
          }),
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
