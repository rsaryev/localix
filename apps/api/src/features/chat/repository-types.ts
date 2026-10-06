import type { AgentSessionKind, ReasoningEffort } from '../../db'
import type { PermissionMode } from '../capabilities/permission-modes'
import type { SessionProvenance } from './session-provenance'

/**
 * Row/record shapes for the chat repository, split out of repository.ts so the
 * factory file stays focused on queries. Re-exported from ./repository, so all
 * existing importers (`SessionRecord`, the History* row types) keep their paths.
 */

/** One FTS5 hit from searchHistory — a matched message snippet. */
export interface HistorySearchHit {
  sessionId: string
  role: string
  snippet: string
  createdAt: string
}

/** An FTS5 hit that also carries the matched message id + sequence (history_search v2 discovery). */
export interface HistorySearchHitDetailed extends HistorySearchHit {
  messageId: string
  sequence: number
}

/** A raw history message row used by history_search window / bookend / browse helpers. */
export interface HistoryMessageRow {
  id: string
  sessionId: string
  role: string
  payloadJson: string
  sequence: number
  createdAt: string
}

/** A session row for history_search browse mode (recent sessions). */
export interface RecentSessionRow {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
  messageCount: number
  firstUserPayloadJson: string | null
}

/** Title + timestamps for a known session id (history_search discovery grouping). */
export interface SessionMetaRow {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
}

/**
 * What one run costs to address: a connection, a model, and how hard to think.
 *
 * Not owned by a session. A session has a party, and each participant carries one of these —
 * see {@link SessionAgentRoute}. This bare triple is what the latency-sensitive auxiliary
 * paths read when they need only the three values and not who they belong to.
 */
export interface ModelRoute {
  providerConnectionId: string | null
  modelId: string
  reasoningEffort: ReasoningEffort
}

/**
 * What the user last CHOSE, which is the "recent" level of the model chain
 * (`agent-route-resolution.ts`) — per agent, plus the freshest of any agent as the floor.
 *
 * Read out of the seats themselves rather than kept in a store of its own: a seat holds a model
 * only when someone picked one there, so the seats already are this record, and a second copy
 * would be a second thing to keep in step with the picker.
 */
export interface RecentRoutes {
  byAgent: Map<string, { providerConnectionId: string | null; modelId: string }>
  effortByAgent: Map<string, ReasoningEffort>
}

/**
 * One participant of a session, and the route its turns run on.
 *
 * Defined once, in the WIRE contract, and re-exported here: the browser asks the same question
 * of the same shape, and a second declaration on this side would be a copy free to drift. The
 * route is per (session, agent) and not per session, because a session with several agents
 * needs one per agent and a session with one is simply that case with a single row. An agent's
 * registry record carries a GLOBAL preferred model; this is the choice made for it HERE,
 * seeded from that global one when the participant joins and overriding it after.
 */
import type { SessionAgentRoute } from './contracts/read-model'
export type { SessionAgentRoute }

export interface SessionRecord {
  /** Read-only database projection; pre-insert records do not carry it. */
  messageCount?: number
  id: string
  userId: string
  /** Global sequence → canonical `LOCALIX-<seq>` id. DB-assigned; absent on a
   *  pre-insert literal, populated when read back. */
  seq?: number
  title: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  executionBackend: 'local' | 'ssh' | 'docker'
  executionTarget: string | null
  /** Never null: every session belongs to a project (see `projects/default-project.ts`). */
  projectId: string
  parentSessionId: string | null
  rootSessionId: string | null
  sessionKind: AgentSessionKind
  runtimeStatus: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  externalAgentProvider?: string | null
  externalAgentSessionKey?: string | null
  sourceToolCallId: string | null
  /** Durable creator/topology metadata used to reconstruct execution policy after restart. */
  provenance: SessionProvenance
  /**
   * WHO this conversation is with and what each of them runs on, in join order — never empty.
   * One participant is a 1-1 chat; several make it a group. The human is not listed: they are
   * in every session by construction, and they do not run on a model.
   *
   * A handle that no longer resolves (a disabled or deleted agent) degrades to the product's
   * default identity rather than failing the run, so a roster change can never strand a
   * conversation. The ROUTE survives regardless — it is stored here, not looked up.
   */
  agents: SessionAgentRoute[]
  /**
   * The participants are FIXED: nobody changes `agents` any more — not the person, not an agent's
   * `conversation_control`, not a board assignment. Chosen before the conversation starts and
   * settled from its first message on (`roster-lock.ts`).
   */
  rosterLocked: boolean
  /**
   * When a delegated child was CLOSED (`agents close`), or null while it is open. A closed child
   * is terminal history: no wake, no message, no send reaches a run in it again.
   */
  closedAt?: string | null
  /**
   * How the agent's rules are rewritten for this conversation's runs (`permission-mode-policy.ts`).
   * Meaningful on a ROOT session only: a delegated child runs under its root's mode. Absent on a
   * record built in memory before it is stored, which is the default mode.
   */
  permissionMode?: PermissionMode
  /** Optional conversation description. */
  description: string | null
  /** A group's avatar ref (media id or emoji); null = generated from the title. */
  avatar: string | null
  /** Skill names pinned to this session (warmed into the system prompt). */
  pinnedSkills: string[]
  /**
   * Deferred tool names this session has already activated, in activation order.
   *
   * The model decided these belong to the conversation; remembering that is what stops it from
   * re-activating the same tool on every turn. Read on every run, written when a new name is activated.
   */
  activatedTools: string[]
  /** ISO timestamp of when the chat was archived, or null = active. Archived chats
   *  are hidden from the sidebar by default; unarchive clears it. */
  archivedAt: string | null
  /**
   * Addressable agent name — the session's canonical path in its tree (`/root`,
   * `/root/audit_repo`). REPOSITORY-ASSIGNED, exactly like `seq`: absent on a pre-insert literal,
   * populated when read back. `insertSession` derives it from the record's topology and title and
   * claims a collision-free variant in the same transaction as the insert, so a caller cannot
   * choose it (and two parallel spawns cannot claim the same one). Null only for sessions that
   * predate the column. See `features/agent-core/agent-task-name.ts`.
   */
  taskName?: string | null
}

/**
 * The last thing said in a session, as a dialog list shows it.
 *
 * `from` is the stored `ParticipantRef` — the AUTHOR, not the transport role — because a
 * list of sessions with several agents has to say who spoke, and role cannot: an agent's
 * own line is `assistant` to itself and input to everyone else.
 */
export interface LastMessagePreview {
  from: string
  authorSnapshot?: { handle: string }
  /** One line, already collapsed and clamped by the server. */
  text: string
  at: number
}
