import type { AgentSessionKind, ReasoningEffort } from '../../../db/types'
import type { PermissionMode } from '../../capabilities/permission-modes'
import type { LastMessagePreview, ModelRoute } from '../repository-types'
import type { SessionDeletionContext } from './session-deletion'
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
