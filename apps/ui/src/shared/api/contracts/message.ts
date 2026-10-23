import type {
  MessageBinding,
  MessageProviderMeta,
  MessageTiming,
  WakeSource,
} from '@localixai/api/client'
import type {
  ChatCacheDiagnosticsPayload,
  ChatDataPart,
  ChatStatusPayload,
  ChatUsagePayload,
} from '@localixai/agent'
import type { AgentItem } from '@localixai/agent/agents'
import type { StatusTone } from '@localixai/mini-app-sdk/ui'
import type { Recovery } from '@localixai/api/recovery'
import type { PermissionMode } from '@localixai/api/permission-modes'

// ---- Messages (UI shape) ----------------------------------------------------

/** Visual tone for an inline system notice — the app's one tone union (`StatusTone`). */
export type SystemNoticeTone = StatusTone

/** Categories of compact inline system notices rendered in the chat timeline. */
export type SystemNoticeKind =
  | 'model_change'
  | 'reasoning_change'
  | 'connection_change'
  | 'hook_notice'
  | 'terminal_activity'
  /** A run the backend was mid-way through when its process restarted. */
  | 'run_interrupted'
  /** A run that stopped on the person's own turn limit, with work possibly left undone. */
  | 'turn_limit'
  /** A run that ended in an error the same request might survive. */
  | 'run_failed'
  | 'run_continued'
  /** Someone joined or left; the model reads the deduplicated system context binding. */
  | 'participants_change'
  /** A chain of participant handoffs reached its bound; the conversation is back with the person. */
  | 'handoff_limit'
  /**
   * Where the agent's working view now begins: the turns above were checkpointed. Client-owned
   * (`modelViewDivider.ts`), drawn from the session's `modelView`.
   */
  | 'context_checkpoint'
  /** The conversation's permission mode changed (the person, or a plan approval, switched it). */
  | 'permission_mode_change'
  /** A plan's lifecycle, as the agents read it too: presented, sent back, approved, put aside, done. */
  | 'plan_presented'
  | 'plan_changes_requested'
  | 'plan_approved'
  | 'plan_dismissed'
  | 'plan_resumed'
  | 'plan_completed'

/**
 * What a notice offers the reader, when it offers anything.
 *
 * Chosen by the HOST, never inferred here from `kind`: whether trying again is reasonable
 * depends on what the run was doing when it stopped, which is knowledge this side does not
 * have. `retry` re-runs the turn the notice is about — see `regenerate`; the other verbs
 * (`open-settings:<tab>`, `sign-in:<connection>`, `restart:<subject>`) navigate, resolved by the
 * server's one vocabulary (`@localixai/api/recovery`).
 */
export type SystemNoticeRecovery = Recovery

export interface CommandOutput {
  command: string
  tone: 'neutral' | 'success' | 'warning' | 'error'
  text: string
  /** Client-owned optimistic lifecycle state; settled server rows omit it. */
  activity?: CommandActivity
}

export interface CommandActivity {
  kind: 'plugin'
  action: 'install' | 'update' | 'remove' | 'enable' | 'disable' | 'create'
  state: 'running'
  label: string
  subject?: string
}

/**
 * A non-conversational, centered inline notice (e.g. "Switched API key",
 * "Model changed to …"). Its prose is presentation-only; persisted notices may carry a
 * separate context binding that reaches the model through the volatile runtime tail.
 */
export interface SystemNotice {
  kind: SystemNoticeKind
  tone: SystemNoticeTone
  /** Primary, already-composed line. */
  text: string
  /** Optional secondary detail (reason, status code, etc.). */
  detail?: string
  /** Routine lifecycle detail belongs to an action block; problems remain visible inline. */
  activity?: { id: string; state: 'running' | 'completed' | 'stopped' | 'failed' }
  /**
   * The mode a `permission_mode_change` switched to, drawn with that mode's own icon and tone.
   * Absent on rows written before the server stored it — those keep the generic look.
   */
  mode?: PermissionMode
  /** What can be done about it, first is primary. Absent = there is nothing to do but read it. */
  recovery?: readonly SystemNoticeRecovery[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  /**
   * Who WROTE this — `user`, `system`, or `agent:<handle>`. The absolute author, as stored.
   *
   * Distinct from `role`, which is the transport projection for whoever is reading: in a group
   * chat one agent's own line is `assistant` to itself and input to everyone else, so a row
   * that carried only `role` could not say whose line it is. Absent on the volatile rows the
   * client synthesizes (terminal waits), which nobody authored.
   */
  from?: string
  authorSnapshot?: { handle: string }
  /** The person's marks on this message, with one entry per (author, emoji). */
  reactions?: { emoji: string; from: string; at: string }[]
  /** The person keeps this message in the agent's view across context checkpoints. */
  pinned?: boolean
  /** Ticked boxes of the reply's checklist, by `<text item>:<source offset>` (`MarkdownTaskList`). */
  taskStates?: Record<string, boolean>
  /** What a MessageDisplay hook shows in place of a text item, by item id; display only. */
  displayTexts?: Record<string, string>
  content?: string
  /** Present iff this is an inline system notice (role === 'system'). */
  systemNotice?: SystemNotice
  /** Count of consecutive equal system messages; client-owned presentation metadata. */
  systemRepeatCount?: number
  /** Durable slash-command output rendered as application chrome, not assistant prose. */
  commandOutput?: CommandOutput
  /** Volatile terminal lifecycle marker used to coalesce repeated poll/input
   * activity without flooding the transcript. Never persisted or model-facing. */
  terminalLifecycle?: {
    kind: 'waiting' | 'input' | 'finished'
    terminalId: string
    active?: boolean
    count: number
    label?: string
  }
  /**
   * For system notices: the id of the conversation message this notice followed
   * when it was created. The render layer interleaves the notice right after that
   * message, so it keeps its chronological position across workspace refetches
   * instead of drifting to the bottom. `null` = before the first message.
   */
  afterMessageId?: string | null
  /** Arrival position captured while an assistant reply was growing. Items are
   * rendered whole; routine notices wait for their narrative item to close.
   * Character offsets are provenance, never Markdown split points. */
  withinMessage?: { itemId?: string; textOffset?: number; contentOffset?: number }
  /** Projection-only notices rendered between this reply's items. Never sent to the API. */
  inlineNotices?: Message[]
  /** Projection-only standalone activity group, shown through the existing action disclosure. */
  systemActivity?: Message[]
  reasoning?: string
  /** Normalized ordered item list — the single source of truth for rendering. */
  items?: AgentItem[]
  /** IDs whose card-only fields are fetched when their collapsed ToolChain opens. */
  deferredToolItemIds?: string[]
  dataParts?: ChatDataPart[]
  usage?: ChatUsagePayload
  cacheDiagnostics?: ChatCacheDiagnosticsPayload
  status?: ChatStatusPayload
  loadingMessage?: string
  /** Session-tree branch position at a branch point (alternative regenerations). */
  branchIndex?: number
  branchCount?: number
  /** System-generated message (for example a wake's hidden prompt row) — hidden in the UI. */
  isInternal?: boolean
  /** Exact preceding assistant row in the same execution, split by mid-run steering. */
  continuedFromMessageId?: string
  /** UI-only marker (e.g. a mode-switch boundary): shown in the transcript as a thin
   *  divider, never sent to the model. The inverse of `isInternal`. */
  uiOnly?: boolean
  /**
   * Client-painted placeholder shown the instant you hit Enter, before the server
   * echoes the real row. The `message.created` echo replaces it IN PLACE (matched
   * by role), so the transcript never flashes append→duplicate→remove. Never
   * persisted and never sent anywhere.
   */
  optimistic?: boolean
  /**
   * Minted by the client and absent from every backend body, so a whole-body replace
   * must CARRY it rather than let the fresh body delete it (`mergeSessionBody`).
   *
   * `role === 'system'` cannot stand in for this: `toUiMessage` projects any persisted
   * row carrying a `systemNotice` or `commandOutput` to `role: 'system'` too, and one of
   * the notice KINDS exists on both sides (the backend persists a `mode_change` on every
   * `/mode` switch, `systemNotices.modeChange` paints a client-only one). The distinction
   * is provenance, not shape, so it is recorded explicitly at the point of minting.
   *
   * NOT set on `toUiSession`'s `terminal-wait-snapshot-*` rows: those are re-derived from
   * `detail.terminalWaits` on every fetch, so carrying them would duplicate them.
   */
  clientOnly?: boolean
  /**
   * Stable RENDER identity across the echo claim. The claim swaps the
   * `optimistic-*` id for the server id in the same slot; keying rows on the raw
   * id would remount the row mid-animation (~100-300ms after Enter). The claim
   * stamps the placeholder's id here so the transcript keys on
   * `renderKey ?? id` and the row survives the swap. Client-only, never persisted.
   */
  renderKey?: string
  /**
   * Optimistic user rows represented by this persisted echo. Usually one id;
   * a compatible queued band can be persisted as one combined user turn.
   */
  clientMessageIds?: string[]
  /** Every entity linked to this message: assets, context, and invocations. */
  bindings?: MessageBinding[]
  /** Timing telemetry for this assistant message (model/tool/idle/hitl breakdown). */
  timing?: MessageTiming
  /** Which provider + API key produced this message — rendered as a footer badge. */
  providerMeta?: MessageProviderMeta
  /**
   * Command origin badge: set when this user message was injected by a slash command
   * that forwarded to the agent (e.g. `/loop 5m`, `/mode yolo`). Rendered as a small
   * "via /loop · every 5m" chip above the user bubble.
   */
  commandOrigin?: { command: string; label: string }
  /**
   * Provenance of an autonomously-woken turn (the backend `WakeSource` tag, stored
   * as the message payload's `origin`): why a non-user turn ran — a `/loop` tick, a
   * plugin's wake, a `sleep`/background-job completion, or the
   * background-job monitor. Kept as transport metadata for non-web surfaces and
   * diagnostics; the web transcript deliberately does not render an origin badge.
   * `user-busy` identifies a genuine user message rather than an autonomous wake.
   */
  wakeSource?: WakeSource
  /** ISO wall-clock time the message row was persisted — shown beside the author's name
   *  (or in the footer of the user's own line) as a clock, dated once it is not from
   *  today. Absent on optimistic messages not yet round-tripped through the server. */
  createdAt?: string
}
