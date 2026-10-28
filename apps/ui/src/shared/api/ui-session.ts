/**
 * THE SESSION AS THE BROWSER HOLDS IT.
 *
 * One conversation in the store: the server's summary plus everything the client learns live
 * (the streaming row, the HITL queue, diagnostics) and everything it derives
 * for itself (`bodyLoaded`, `readOnly`). Its own module because it is the largest single shape
 * in the client contract and the one that grows with every feature — a field per strip above
 * the composer — and `contracts.ts` is the barrel every screen imports; a barrel that carries
 * the store's biggest record grows past what a reader can hold in view.
 *
 * `contracts.ts` re-exports these two types, so every existing import keeps working; new code
 * may import either.
 */
import type { ChatUsagePayload } from '@localixai/agent'
import type {
  LastMessagePreview,
  ResumePoint,
  SessionAgentRoute,
  SessionPlan,
} from '@localixai/api/client'
import type { PermissionMode } from '@localixai/api/permission-modes'
import type {
  LspDiagnostic,
  LspServerState,
  Message,
  SessionLoopSummary,
  SessionQueueItem,
  SessionSourceRuntime,
  SessionWork,
  SessionTiming,
  UiPendingHitlInteraction,
} from './contracts'

export interface UiSession {
  id: string
  /** Global sequence → the canonical `LOCALIX-<seq>` id (see `sessionRef`). */
  seq: number
  title: string
  messages: Message[]
  /**
   * UI hydration marker. `false` means this object came from the workspace/session
   * list and its empty `messages` array is NOT evidence that the conversation is
   * empty. Detail responses set it to `true`; legacy/test-created objects omit it
   * and are treated as loaded.
   */
  bodyLoaded?: boolean
  /** Server-computed all-history usage; live message snapshots replace their prior contribution. */
  sessionUsage?: ChatUsagePayload
  isPinned: boolean
  /** Soft-archived: hidden from the sidebar by default, but not deleted. */
  isArchived: boolean
  /**
   * This conversation cannot be written to — the composer is not offered at all.
   *
   * Set by a CLIENT-SIDE session adapted from a source we do not own (an external agent's history
   * read off disk). It is a property of the session rather than of its kind because "there is
   * nowhere to send this" is not something a kind can express: a foreign transcript is a `chat` in
   * every other respect.
   */
  readOnly?: boolean
  createdAt: number
  updatedAt: number

  /**
   * The HITL request the overlay is showing — the HEAD of the queue below, kept as
   * its own field so every consumer reads one interaction, as before.
   */
  pendingInteraction: UiPendingHitlInteraction | null
  /**
   * Unanswered HITL requests waiting BEHIND `pendingInteraction`, oldest first.
   *
   * A session can have two requests outstanding at once — two parallel `write`s
   * that both need approval (write's executionMode is 'parallel' when the host
   * allows it), or a background sub-agent whose confirm routes UP to this parent
   * session (hitl-target.ts) while the parent has its own prompt open. A single
   * slot meant the second request silently EVICTED the first: its card vanished,
   * the user never answered it, and whoever was awaiting it blocked until it timed
   * out. Queueing keeps the first answerable — answering it promotes the next.
   */
  pendingInteractionQueue: UiPendingHitlInteraction[]
  /** True when the agent runner is actively processing this session (from server). */
  isRunning: boolean
  /**
   * Id of the assistant message currently receiving the live stream (from
   * `message.created`/`message.delta`), cleared at run boundaries. The transcript
   * must gate its "streaming" visuals on this id — deriving it positionally
   * ("last assistant row while running") mis-tags the PREVIOUS reply during the
   * send→echo round-trip window and makes it visibly re-type from scratch.
   */
  streamingMessageId?: string | null
  isUnread?: boolean
  /** Never null: every session belongs to a project (the default one when none was picked). */
  projectId: string
  parentSessionId: string | null
  rootSessionId: string | null
  sessionKind: 'chat' | 'subagent' | 'job' | 'system'
  /**
   * The conversation's one agent and the model its turns run on, fixed at creation. The model
   * picker offers it and writes back to it. Null for a session that runs no model.
   */
  agent: SessionAgentRoute | null
  /** How the agent's rules are rewritten for this conversation (`@localixai/api/permission-modes`). */
  permissionMode: PermissionMode
  /** A delegated child its delegator closed; nothing wakes it, and its composer is read-only. */
  closedAt?: string | null
  /** Optional conversation description. */
  description: string | null
  runtimeStatus: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  externalAgentProvider?: string | null
  externalAgentSessionKey?: string | null
  sourceToolCallId: string | null
  sourceRuntime: SessionSourceRuntime | null
  pinnedSkills: string[]
  /** Aggregate timing across the session's messages (null until computed). */
  sessionTiming: SessionTiming | null
  /** Persisted message count (from list/detail reads). Lets the UI show a child
   *  thread's size without loading its (evicted) bodies. Defaults to 0. */
  messageCount: number
  /**
   * The last thing said, for the sidebar row's preview line. Absent until a list read
   * supplies it — a live `session.updated` omits it, so the merge keeps the prior value
   * rather than blanking the row mid-run.
   *
   */
  lastMessage?: LastMessagePreview
  lspServers: LspServerState[]
  /**
   * Ephemeral per-file LSP diagnostics (ranges + severity) for files the inspector
   * editor has open, keyed by absolute path. SSE-only (live `lsp.diagnostics`), not
   * persisted — empty until the editor opens a file.
   */
  lspDiagnostics: Record<string, LspDiagnostic[]>
  /** Active session loops (DB-backed; carried on session list + detail load, and live via session_triggers.updated). */
  loops: SessionLoopSummary[]
  /** The session's running background work, monitors included — carried on list/detail load, live via session_work.updated. */
  work?: SessionWork[]
  /**
   * Every version of the conversation's plan, newest first, on the ROOT session — carried by its
   * detail (which replaces it on every read), live via `plan.updated`, and replaced by each
   * decision's answer. Absent means unknown (a summary, a child's detail): a surface that needs it
   * then fetches it (`GET /sessions/:id/plans`) rather than a converter blanking it to [].
   */
  plans?: SessionPlan[]
  /**
   * The conversation's unfinished work the person can Continue (`features/resume`), on the ROOT
   * session — carried by its detail, live via `session_resume.updated`, replaced by Continue's
   * answer. Absent means unknown, exactly like `plans`.
   */
  resumePoints?: ResumePoint[]
  /** Tools the user chose to "Always allow" for this session; carried on detail load
   * + live via session_permissions.updated. Ephemeral (in-memory, session-scoped). */
  autoApprovedTools?: string[]
  /** Messages queued behind an in-flight run (backend-owned; carried on list/detail, live via session_queue.updated). */
  queuedMessages: SessionQueueItem[]
  // NOTE: the sub-agent/job runtime ticks that used to live here (`runtimeActivity`,
  // `runtimeTurns`, `runtimeTools`, from `child_session.activity`) are deliberately NOT session
  // state. They arrive many times a second per running child, so holding them on the session made
  // every tick mint a new `allSessions` array and re-derive the whole sidebar. They live in
  // `entities/chat/model/sessionActivityStore.ts`, keyed by session id, subscribed per row.
  /** Ephemeral: current agnostic activity phase (titling, thinking, a terminal
   * wait, …) from the `agent.phase` event. Drives the loading status copy.
   * SSE-only, never persisted. */
  activePhase?: {
    id: string
    label: string
  } | null
}
