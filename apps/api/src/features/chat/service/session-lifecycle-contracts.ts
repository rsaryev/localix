import type { ReasoningModel } from '@localixai/agent'
import type { AgentSessionKind, ReasoningEffort } from '../../../db/types'
import type { PermissionMode } from '../../../contracts/permission-modes'
import type { LastMessagePreview, ModelRoute } from '../repository-types'
import type { SessionDeletionContext } from './session-deletion'
import type { SeatRouteFor } from './session-route-defaults'
import type { SessionRecord } from '../repository'
import type { AgentStreamEvent, PersistedMessage, SessionDetail } from '../contracts'
import type { SessionProvenance } from '../session-provenance'
import type { ResolveSessionAgent, SessionAgentSelection } from './session-agent-selection'

type RuntimeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'

/** Closure values the session-lifecycle operations need from createChatService. */
export interface SessionLifecycleCtx extends Omit<SessionDeletionContext, 'repo'> {
  activeAgentId?: (sessionId: string) => string | undefined
  cancelAgentTurn?: (userId: string, sessionId: string, agentId: string) => Promise<void>
  resolveSessionAgent?: ResolveSessionAgent
  repo: SessionDeletionContext['repo'] & {
    listSessions: (userId: string) => Promise<SessionRecord[]>
    listSessionAncestry: (userId: string, id: string) => Promise<SessionRecord[]>
    lastMessagesByUser: (userId: string) => Promise<Map<string, LastMessagePreview>>
    allocateSessionRef: (userId: string) => Promise<{ seq: number; id: string }>
    insertSession: (session: SessionRecord) => Promise<void>
    /** The newest untouched chat in a project with exactly this participant (see repository-empty-draft). */
    findEmptyDraft?: (
      userId: string,
      projectId: string,
      agentId: string,
      defaultTitle: string,
    ) => Promise<string | null>
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
    /**
     * The person's model choice — the named agents, seated or not — in one transaction (`repository-model-choices.ts`). Required: a per-member
     * fallback would let a failure halfway leave the room half-moved.
     */
    updateSessionAgentRoutes: (
      userId: string,
      id: string,
      routes: readonly ({ agentId: string } & Partial<ModelRoute>)[],
    ) => Promise<void>
    /** For the membership line a party edit writes into the conversation. */
    insertMessage: (message: PersistedMessage) => Promise<void>
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
  /** The one decision of a new seat's route — see `agent-route-resolution.ts`. */
  seatRoute?: SeatRouteFor
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
   * `agent_unavailable` (the seat resolver cannot see agents in a project that is not there),
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
  /**
   * A landing, not a "New chat": reopen the project's newest untouched chat with the same
   * participant instead of minting another one (see session-draft-reuse.ts).
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
  /**
   * Re-route ONE participant — a model belongs to an agent inside a conversation, not to the
   * conversation. Omitting the id means the session's own participant: the only one in a private
   * chat, the first in a group.
   */
  route?: { agentId?: string } & Partial<ModelRoute>
  /**
   * Choose models for several named agents at once — seated, or not yet invited (their choice
   * waits for them). All must be able to take part, or nothing is written.
   */
  routes?: Array<{ agentId: string } & Partial<ModelRoute>>
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
  /** Only a group carries these; a private chat renders its agent instead. The kind itself is
   *  not patchable: it follows the party (see `updateSession`). */
  description?: string | null
  avatar?: string | null
}
