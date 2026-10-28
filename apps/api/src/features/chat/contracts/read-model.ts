import type { z } from 'zod'

import type { ChatUsagePayload } from '@localixai/agent'
import type { ToolBackedItem } from '@localixai/agent/agents'
import type { StoredMessagePayload } from '../../../db/payload'
import type { PermissionMode } from '../../../contracts/permission-modes'
import type { LspServerState } from '../../lsp'
import type { SessionPlan } from '../../plans/contracts'
import type { ResumePoint } from '../../resume/contracts'
import type { LastMessagePreview } from '../repository-types'
import type { reasoningEffortSchema, runtimeStatusSchema, sessionKindSchema } from './session'
import type { SessionLoopSummary, SessionQueueItem, SessionWork } from './queue'
import type { SessionTiming } from '../../../contracts/message-timing'

export type {
  MessageProviderMeta,
  MessageTiming,
  SessionTiming,
  ToolTiming,
} from '../../../contracts/message-timing'
export type { LastMessagePreview } from '../repository-types'

/** The conversation's agent, and the model its turns run on. */
export interface SessionAgentRoute {
  /** Registry identity. Execution must resolve this ID, never the display snapshot. */
  agentId: string
  /** Handle captured at assignment, retained for historical display. */
  name: string
  providerConnectionId: string | null
  modelId: string
  reasoningEffort: z.infer<typeof reasoningEffortSchema>
  /**
   * WHICH level of the model chain answered — the conversation, the project, your last choice
   * for this agent, or its own card (`agent-route-resolution.ts`).
   *
   * Sent because the picker has to say it: a row showing a model with no word about where it
   * came from cannot distinguish "chosen for this agent here" from "following the
   * project", and those differ in what changing it will affect.
   *
   * The MODEL only. There is no companion for the effort and there must not be one: the effort
   * is settled when the route is created and belongs to the conversation from then on, so a
   * field naming a level for it could only ever say `session` — a word that suggests a
   * following relationship the value does not have.
   */
  modelOrigin?: 'session' | 'project' | 'agent' | 'recent' | 'primary' | 'unset'
}

export interface SessionSummary {
  id: string
  /** Global sequence → the canonical `LOCALIX-<seq>` id (see `sessionRef`). */
  seq: number
  title: string
  isPinned: boolean
  goal?: string | null
  previousTopicSummary?: string | null
  /** Soft-archived: hidden from the sidebar by default, but not deleted. */
  isArchived: boolean
  /** Never null — every session belongs to a project (`projects/default-project.ts`). */
  projectId: string
  parentSessionId: string | null
  rootSessionId: string | null
  sessionKind: z.infer<typeof sessionKindSchema>
  /**
   * The conversation's one agent and the model its turns run on, fixed at creation. The human
   * is not an agent: they are in every session by construction and do not run on a model.
   * Null for a session that runs no model.
   */
  agent: SessionAgentRoute | null
  /** A delegated child its delegator closed; null while open. The chat is read-only when set. */
  closedAt: string | null
  /** How the agent's rules are rewritten for this conversation's runs; a child shows its root's. */
  permissionMode: PermissionMode
  /** Optional conversation description. */
  description: string | null
  runtimeStatus: z.infer<typeof runtimeStatusSchema>
  externalAgentProvider?: string | null
  externalAgentSessionKey?: string | null
  sourceToolCallId: string | null
  pinnedSkills: string[]
  /** Ephemeral: active session loops (process-local, dies on restart). Empty when none. */
  loops: SessionLoopSummary[]
  /** Runtime overlay: the session's running background work (`features/work`). Empty when none. */
  work: SessionWork[]
  /** Ephemeral: messages queued behind an in-flight run (process-local; lost on API restart). */
  queuedMessages: SessionQueueItem[]
  /** Aggregate timing across the session's messages. Null when not yet computed. */
  sessionTiming: SessionTiming | null
  /** Persisted message count. Set on the list + detail reads; OMITTED on live
   *  `session.updated` emits (the UI preserves its prior value via spread). Lets
   *  the UI show a thread's size without loading the (evicted) child bodies. */
  messageCount?: number
  /**
   * The last thing said, for a list row's preview line. Set on the list read only —
   * a detail read HAS the messages, and a live `session.updated` omits it so the UI
   * keeps its prior value by spread, exactly like `messageCount`.
   *
   * Carries its AUTHOR, not just its text: a session with several agents needs the row
   * to say who spoke last, and that is the one thing a title and a time cannot say.
   */
  lastMessage?: LastMessagePreview
  createdAt: string
  updatedAt: string
  lastMessageAt: string
}

// Re-exported from its zod-free leaf home (`session-ref.ts`) so server-side
// importers keep taking it from contracts while browser bundles use the leaf
// (`@localixai/api/session-ref`) without dragging this module's schemas along.
export { sessionRef } from '../../../contracts/session-ref'

export interface PersistedMessage {
  id: string
  sessionId: string
  userId: string
  payload: StoredMessagePayload
  /**
   * Read-model-only marker: these settled tool items retain their summary
   * identity but omitted card details in this response. Never persisted and
   * absent from realtime events / ordinary full-detail clients.
   */
  deferredToolItemIds?: string[]
  createdAt: string
  updatedAt: string
  /**
   * Session-tree branch position, computed on read (not persisted): when this
   * message shares a parent with sibling messages (alternative regenerations),
   * `count` is the number of siblings and `index` is this one's position. Absent
   * when there are no alternatives. UI uses it for the ◀ k/n ▶ branch switcher.
   */
  branch?: { index: number; count: number }
}

/** Full card data resolved for one exact owner/session/message point read. */
export interface MessageToolDetails {
  items: ToolBackedItem[]
}

/**
 * File-browser response shapes (viewer/editor, explorer tree, search panel) live
 * in `file-contracts.ts` — they change with the IDE surface, not the agent runtime.
 * Re-exported here so the contract barrel stays one import for every consumer.
 */
export type {
  FileContentResponse,
  FileWriteResponse,
  DirEntry,
  FileEntryResponse,
  FileDeleteResponse,
  DirListing,
  FileUndoResponse,
  FileSearchMode,
  FileSearchType,
  FileSearchEntry,
  FileSearchResult,
  FileContentMatch,
  FileContentSearchResult,
} from '../file-contracts'

export interface PendingHitlInteraction {
  requestId: string
  /** Session whose run created the request; the prompt may be routed to an ancestor. */
  sourceSessionId?: string
  kind: string
  title?: string
  payload: unknown
  /**
   * When silence becomes a refusal, as epoch ms — the SAME instant the HITL controller will
   * act on, forwarded rather than recomputed, so the countdown on the card cannot promise a
   * moment the server disagrees with.
   *
   * On the envelope rather than inside each payload because it is true of every kind: one
   * field the frame reads, instead of four payload-specific spellings the four views each
   * had to know about (and two of them did not).
   */
  expiresAt?: number
}

export interface SessionSourceRuntime {
  toolCallId: string
  toolName: string
  title?: string
  command?: string
  cwd?: string
  description?: string
  isBackground?: boolean
}

/** Server-authoritative active `terminal action="wait"` snapshot. Volatile but
 * carried by SessionDetail so reconnect can restore the status lost with live-only events. */
export interface SessionTerminalWait {
  terminalId: string
  label?: string
}

export interface SessionDetail extends SessionSummary {
  /**
   * Addressable agent name: this session's canonical path in its tree (`/root`,
   * `/root/audit_repo`). Null only for sessions that predate the column.
   *
   * On DETAIL and not on `SessionSummary` deliberately: it is the address a spawning agent needs
   * back from the call that created the child (`Agent` reports it so the caller can message what
   * it just started), not a field the session LIST renders. Assigned once at insert and never
   * updated — renaming an address invalidates every reference a running agent already holds.
   */
  taskName: string | null
  messages: PersistedMessage[]
  /** Canonical all-history usage, even when `messages` is a windowed tail. */
  sessionUsage?: ChatUsagePayload
  /** Active interactive-terminal waits, independently hydrated after reconnect. */
  terminalWaits?: SessionTerminalWait[]
  /**
   * The HITL prompt a client shows first — the OLDEST outstanding one, i.e.
   * `pendingInteractions[0]`. Derived at the source so it can never disagree with the
   * list below.
   */
  pendingInteraction: PendingHitlInteraction | null
  /**
   * EVERY outstanding HITL request for this session, oldest-first — not just the head.
   * More than one is ordinary: `beforeToolCall` blocks per call inside a PARALLEL write
   * segment, and a background sub-agent asks its parent while the parent's own prompt is
   * open. The runtime always tracked them all; the detail used to expose only the first,
   * so a client rebuilding a session from it (reconnect resync, session switch) silently
   * dropped every waiter behind the head and left its caller blocked until timeout.
   */
  pendingInteractions: PendingHitlInteraction[]
  /** True when the agent runner is actively processing this session. */
  isRunning: boolean
  /** Computed runtime context for sessions spawned by a tool call (job/subagent). */
  sourceRuntime: SessionSourceRuntime | null
  /** Current in-memory LSP servers for the session project, if any. */
  lspServers: LspServerState[]
  /**
   * Tool names the user chose to "Always allow" for this session (in-memory,
   * session-scoped — see RuntimeState.sessionAutoApprovedTools). Hydrated on load
   * so the composer permissions chip (see & revoke grants) survives a page reload,
   * not only the live `session_permissions.updated` event. Empty = nothing granted.
   */
  autoApprovedTools?: string[]
  /** Where the model's working view begins, when a checkpoint has moved it. */
  modelView: SessionModelView | null
  /**
   * Every version of the conversation's plan, newest first (`features/plans`) — on a ROOT
   * session's detail only, `[]` when it has none. A delegated child's detail omits it: plans
   * belong to the root, and a child's composer reads its root's list.
   *
   * On the detail, not only on the `plan.updated` frame, because a client that missed one frame
   * (a reconnect gap) kept a stale list forever: the strip offered Approve on a version already
   * approved. Every detail read now replaces the list, so any refetch reconciles it.
   * Absent too when the plans could not be read — "unknown", never a false "none".
   */
  plans?: SessionPlan[]
  /**
   * The conversation's unfinished work (`features/resume`) — on a ROOT session's detail only,
   * `[]` when there is none, absent when it could not be read ("unknown", like `plans`). Live via
   * `session_resume.updated`.
   */
  resumePoints?: ResumePoint[]
}

/**
 * Where the model's working view of a conversation begins, once a context checkpoint moved it.
 * The messages before it stay in the transcript for the person, and the model can still recall
 * any of them by id; they are just no longer sent. Absent until the first eviction.
 */
export interface SessionModelView {
  /** The agent whose view it is — the one whose run took the checkpoint. */
  agentId: string
  /** Messages up to and including this one are outside that view. */
  evictedThroughId: string
}
