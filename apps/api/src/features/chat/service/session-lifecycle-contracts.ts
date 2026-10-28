import type { ReasoningModel } from '@localixai/agent'
import type { AgentSessionKind, ReasoningEffort } from '../../../db/types'
import type { PermissionMode } from '../../../contracts/permission-modes'
import type { LastMessagePreview, ModelRoute } from '../repository-types'
import type { SessionDeletionContext } from './session-deletion'
import type { StartingRouteFor } from './session-route-defaults'
import type { SessionRecord } from '../repository'
import type { AgentStreamEvent, PersistedMessage, SessionDetail } from '../contracts'
import type { SessionProvenance } from '../session-provenance'
import type { ResolveSessionAgent, SessionAgentSelection } from './session-agent-selection'
import type { CcHookSessions } from '../runtime/cc-hook-sessions'

type RuntimeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'

/** Closure values the session-lifecycle operations need from createChatService. */
export interface SessionLifecycleCtx extends Omit<SessionDeletionContext, 'repo'> {
  /** Claude Code hooks a session edit raises between turns (model switch, project move). */
  ccHookSessions?: CcHookSessions
  /** The session's working directory, for CwdChanged when a project move changes it. */
  resolveSessionWorkingDir?: (userId: string, session: SessionRecord) => Promise<string>
  /**
   * Claude Code's mode settings for a folder (`permissions.defaultMode`,
   * `disableBypassPermissionsMode`): the mode a new conversation there starts in, and whether
   * the modes that stop asking are off.
   */
  claudeCodeModes?: (
    cwd: string,
  ) => Promise<{ defaultMode?: PermissionMode; bypassDisabled: boolean }>
  resolveSessionAgent?: ResolveSessionAgent
  repo: SessionDeletionContext['repo'] & {
    listSessions: (userId: string) => Promise<SessionRecord[]>
    listSessionAncestry: (userId: string, id: string) => Promise<SessionRecord[]>
    lastMessagesByUser: (userId: string) => Promise<Map<string, LastMessagePreview>>
    allocateSessionRef: (userId: string) => Promise<{ seq: number; id: string }>
    insertSession: (session: SessionRecord) => Promise<void>
    /** The newest untouched chat in a project with exactly this agent (see repository-empty-draft). */
    findEmptyDraft?: (
      userId: string,
      projectId: string,
      agentId: string,
      defaultTitle: string,
    ) => Promise<string | null>
    getSession: (userId: string, id: string) => Promise<SessionRecord | null>
    /** The session's own fields; only the keys present are written. */
    updateSession: (userId: string, id: string, patch: Partial<SessionRecord>) => Promise<void>
    /** A deliberate re-route of the session's agent — the only write that touches its route. */
    updateSessionAgentRoute: (
      userId: string,
      id: string,
      route: Partial<ModelRoute>,
    ) => Promise<void>
    /** For the notice a route edit writes into the conversation. */
    insertMessage: (message: PersistedMessage) => Promise<void>
  }
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  now: () => string
  /** The one decision of a new session's route — see `agent-route-resolution.ts`. */
  startingRoute?: StartingRouteFor
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
  /**
   * Does this user hold this project? Same shape as {@link connectionExists}: a UI holding a
   * project id from a recreated database used to have its New chat refused as
   * `agent_unavailable` (the route resolver cannot see agents in a project that is not there),
   * a message about the wrong thing. Optional for the same reason.
   */
  projectExists?: (userId: string, projectId: string) => Promise<boolean>
  /**
   * The reasoning capability of the model a route names, for clamping a stated level
   * (`clampRoutePatch`). Null when the catalog cannot resolve it; absent in a narrow host.
   */
  reasoningModel?: (
    userId: string,
    connectionId: string | null,
    modelId: string,
  ) => Promise<ReasoningModel | null>
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
  externalAgentProvider?: string
  externalAgentSessionKey?: string
  externalAgentHistory?: { startedAt?: number; updatedAt: number }
  title?: string
  goal?: string | null
  previousTopicSummary?: string | null
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
   * The one agent this conversation is with, fixed for its life. Omitted = the default agent.
   *
   * It may carry its own route. A caller that has resolved an agent's registry record passes its
   * preferred model here; one that has not passes the handle alone and the route is seeded from
   * the session-level fallback.
   */
  agent?: SessionAgentSelection & Partial<ModelRoute>
  /** The conversation's description. */
  description?: string | null
  /**
   * A landing, not a "New chat": reopen the project's newest untouched chat with the same
   * agent instead of minting another one (see session-draft-reuse.ts).
   */
  reuseEmptyDraft?: boolean
}

export interface UpdateSessionPatch {
  externalAgentProvider?: string
  externalAgentSessionKey?: string
  title?: string
  goal?: string | null
  previousTopicSummary?: string | null
  /** The conversation's permission mode — a root's only; written to its whole tree. */
  permissionMode?: PermissionMode
  /** Re-route the conversation's agent: what it runs on, never who it is. */
  route?: Partial<ModelRoute>
  isPinned?: boolean
  isArchived?: boolean
  /** Move the session to another project. Never null — a session always belongs to one. */
  projectId?: string
  runtimeStatus?: RuntimeStatus
}
