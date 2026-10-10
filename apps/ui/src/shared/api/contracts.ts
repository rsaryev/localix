import type {
  App,
  AgentStreamEvent,
  PreviewCommand,
  FileContentResponse,
  FileWriteResponse,
  FileEntryResponse,
  FileDeleteResponse,
  FileUndoResponse,
  SessionLoopSummary,
  SessionWork,
  SessionQuestion,
  SessionQueueItem,
  QueueClearResult,
  QueuePromoteResult,
  QueueRemovalResult,
  WakeSource,
  DirListing,
  DirEntry,
  FileSearchResult,
  FileSearchEntry,
  FileSearchMode,
  FileSearchType,
  FileContentMatch,
  FileContentSearchResult,
  CatalogResponse,
  EnvDetectedProvider,
  PendingHitlInteraction,
  PersistedMessage,
  MessageToolDetails,
  ProviderConnection,
  SessionBranchTree,
  SessionDetail,
  SessionModelView,
  SessionSourceRuntime,
  SessionSummary,
  SessionTiming,
  MessageTiming,
  MessageProviderMeta,
  LspServerState,
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspCodeAction,
  LspHoverInfo,
  LspSignatureHelp,
  LspInlayHint,
  LspColorInfo,
  LspDocumentSymbol,
  LspDocumentHighlight,
  LspCompletionItem,
  CodeLocation,
  CodeReference,
  WorkspaceSymbol,
  HistorySearchHit,
  RenamePrepare,
  RenameResult,
  Project,
  ResolveProjectByPathResponse,
  UpdateProjectRequest,
  ProjectSettingsPatch,
  ContextRef,
  ContextRefExpansion,
  ExpandRefsRequest,
  ExpandRefsResponse,
  UserProfile,
  UpdateUserProfileRequest,
  UiSettings,
  UiSettingsPatch,
  AgentSettings,
  AgentSettingsPatch,
  MessageMutationResponse,
  MessageAttachment,
  MessageBinding,
  MessageContextBinding,
  UsageStatRow,
  UsageOverview,
  UsageLogRow,
  UsageLogsPage,
  UsageKeys,
  SkillRecord,
  SkillInput,
  SkillSummary,
  VaultItemType,
} from '@localixai/api/client'

export { PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS } from '@localixai/api/settings-limits'

import type {
  AskToolRequest,
  ConfigChangeRequest,
  ConfirmToolRequest,
  PluginRecord,
  PluginCommandSpec,
  MarketplaceListing,
  AgentRecord,
  AgentRecordInput,
  AgentSummary,
  McpServer,
  McpServerInput,
  McpServerStatus,
  ImportMcpServersResponse,
  McpTransport,
  McpStdioConfig,
  McpHttpConfig,
  CapabilitySnapshot,
  CapabilityRuleChange,
  CapabilityToolSurface,
  ToolSurfaceDenial,
  ToolGcReport,
} from '@localixai/api/client'
import type {
  ChatCacheDiagnosticsPayload,
  ChatDataPart,
  ChatStatusPayload,
  ChatUsagePayload,
  ReasoningEffort,
} from '@localixai/agent'
import type { AgentItem } from '@localixai/agent/agents'
import type { StatusTone } from '@localixai/plugin-sdk/ui'
import type { Recovery } from '@localixai/api/recovery'
import type { PermissionMode } from '@localixai/api/permission-modes'

// ---- Pending HITL interactions (UI shape) -----------------------------------
// The client-side shape of a pending ask/quiz/confirm request, derived from the
// API contract types. Defined here (shared) so both the backend client and the
// chat feature can use them; features/chat/model/agent-runtime re-exports them.

interface PendingHitlSource {
  /** Session whose run created this request; it may be rendered on an ancestor. */
  sourceSessionId?: string
}

export interface PendingAskInteraction extends PendingHitlSource {
  kind: 'ask'
  request: Omit<AskToolRequest, 'createdAt'> & { title?: string }
}

export interface PendingConfirmInteraction extends PendingHitlSource {
  kind: 'confirm'
  request: Omit<ConfirmToolRequest, 'createdAt'> & { title?: string }
}

/**
 * The value-free REQUEST leg of the `request_secret` HITL kind (raised by the `vault`
 * tool's create/rotate actions — there is no tool of that name): the overlay shows the
 * key + reason and collects the value in a masked input. The typed value itself
 * never joins this shape — it rides its own `submit-secret` frame straight to the
 * server's encrypted vault (see backendClient.submitSecret).
 */
export interface PendingRequestSecretInteraction extends PendingHitlSource {
  kind: 'request_secret'
  request: {
    id: string
    kind: 'request_secret'
    title?: string
    /** When silence becomes a refusal — the envelope field every other kind inherits. */
    expiresAt?: number
    payload: {
      action: 'create' | 'rotate'
      key: string
      reason: string
      type: VaultItemType
      label?: string
      description?: string
      tags: string[]
      expectedVersion?: number
    }
  }
}

/**
 * An agent-proposed configuration change awaiting the user's click (raised by the
 * `configure` tool). The payload IS the card: title, detail, diff and the scope choice.
 */
export interface PendingConfigChangeInteraction extends PendingHitlSource {
  kind: 'config_change'
  request: Omit<ConfigChangeRequest, 'createdAt'> & { title?: string }
}

export type UiPendingHitlInteraction =
  | PendingAskInteraction
  | PendingConfirmInteraction
  | PendingRequestSecretInteraction
  | PendingConfigChangeInteraction

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

export type { ReasoningEffort }

export type {
  App,
  AgentStreamEvent,
  PreviewCommand,
  FileContentResponse,
  FileWriteResponse,
  FileEntryResponse,
  FileDeleteResponse,
  FileUndoResponse,
  DirListing,
  DirEntry,
  FileSearchResult,
  FileSearchEntry,
  FileSearchMode,
  FileSearchType,
  FileContentMatch,
  FileContentSearchResult,
  CatalogResponse,
  EnvDetectedProvider,
  ProviderConnection,
  SessionBranchTree,
  SessionDetail,
  SessionModelView,
  SessionLoopSummary,
  SessionWork,
  SessionQuestion,
  SessionQueueItem,
  QueueClearResult,
  QueuePromoteResult,
  QueueRemovalResult,
  WakeSource,
  SessionSourceRuntime,
  SessionSummary,
  SessionTiming,
  MessageTiming,
  MessageProviderMeta,
  PendingHitlInteraction,
  PersistedMessage,
  MessageToolDetails,
  LspServerState,
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspCodeAction,
  LspHoverInfo,
  LspSignatureHelp,
  LspInlayHint,
  LspColorInfo,
  LspDocumentSymbol,
  LspDocumentHighlight,
  LspCompletionItem,
  CodeLocation,
  CodeReference,
  WorkspaceSymbol,
  HistorySearchHit,
  RenamePrepare,
  RenameResult,
  Project,
  ResolveProjectByPathResponse,
  UpdateProjectRequest,
  ProjectSettingsPatch,
  ContextRef,
  ContextRefExpansion,
  ExpandRefsRequest,
  ExpandRefsResponse,
  UserProfile,
  UpdateUserProfileRequest,
  UiSettings,
  UiSettingsPatch,
  AgentSettings,
  AgentSettingsPatch,
  MessageMutationResponse,
  MessageAttachment,
  MessageBinding,
  MessageContextBinding,
  UsageStatRow,
  UsageOverview,
  UsageLogRow,
  UsageLogsPage,
  UsageKeys,
}

// ---- Skills -------------------------------------------------------------------
/**
 * Same rule as MCP below: ONE owner — `features/chat/service/skills.ts`. These were
 * hand-restated here and had gone stale in the same lethal direction: the copy read
 * back `argumentHint`/`userInvocable` but `SkillInput` could express neither, so the
 * settings form rebuilt a SKILL.md from the three fields its type could see. The
 * write path preserves the file's frontmatter now, but the restatement was what let
 * a reader outrun its writer in the first place. Re-export; never restate.
 */
export type { SkillRecord, SkillInput, SkillSummary }

/** Per-skill curator/usage record (filesystem skills only — never plugin/bundled ones). */
export interface CuratorSkillRecord {
  name: string
  description: string
  scope: 'global' | 'project'
  /** Absolute path to the skill directory (archived skills live in `.archive/`). */
  dir: string
  getCount: number
  lastUsedAt: string | null
  pinned: boolean
  archivedAt: string | null
  state: 'active' | 'stale' | 'archived'
}

/** Result of a curator pass. */
export interface CuratorReport {
  active: number
  stale: number
  archived: number
  archivedNow: string[]
}

// ---- MCP ---------------------------------------------------------------------
/**
 * Same rule as the plugin records below: ONE owner — the API's zod contracts in
 * `features/mcp/contracts.ts`. These types used to be hand-restated here, and the
 * copy had gone stale in the worst way available: `McpServerConfig` declared 4 of
 * the wire's 9 config fields, so the settings form needed a cast to reach the
 * rest — and then rebuilt `config` from only the names its type could see. The
 * server replaces `config` wholesale, so editing a server (even just renaming it)
 * silently and permanently wiped its OAuth credentials and timeout/filter
 * fields. Re-export; never restate.
 */
export type {
  McpTransport,
  McpStdioConfig,
  McpHttpConfig,

  /** The SAVE payload. Its `config` is the owner's strict `stdio | http` union. */
  McpServerInput,
}

/**
 * A config whose transport has NOT been narrowed: every field of either
 * transport, all optional. DERIVED from the owner's two schemas — add a field to
 * `mcpStdioConfigSchema`/`mcpHttpConfigSchema` and it shows up here for free, so
 * no reader or writer can silently fall behind the wire again.
 *
 * This is the shape for READING (`s.config.url` off a record) and for the
 * settings form's draft, which edits fields before the transport is settled. It
 * is deliberately NOT the save payload: `mcpDraft.ts` narrows to the owner's
 * strict union at the wire boundary, which is what forces the carry-through.
 */
export type McpServerConfig = Partial<McpStdioConfig & McpHttpConfig>

/** A server as the UI reads it: the owner's record, config left un-narrowed. */
export type McpServerRecord = Omit<McpServer, 'config'> & {
  config: McpServerConfig
}

/** Result of a live connection probe — lists discovered tool names or an error. */
export type McpProbeResult = McpServerStatus

/** Outcome of a bulk `mcpServers` JSON import: created servers + per-entry errors. */
export type McpImportResult = ImportMcpServersResponse

// ---- Plugins, agent providers, managed agents --------------------------------
/**
 * These wire records have ONE owner: the API's zod contracts, re-exported here
 * (type-only, so no zod reaches the client chunk) rather than restated. Each was
 * previously hand-copied into this file — and the copies had silently drifted:
 * `PluginProvides` had lost `lspServers`, `AgentRecord` had lost `hooks`, and
 * `AgentRecordInput` had lost both `hooks` and `enabled` (so the UI's own type
 * could not express the inert-create the backend already accepts). Nothing —
 * not tsc, not a test — said a word, because a copy agrees with its original
 * right up until it doesn't. Re-export; never restate.
 */
export type {
  PluginRecord,
  PluginCommandSpec,
  MarketplaceListing,
  AgentRecord,
  AgentRecordInput,
  AgentSummary,
}

/**
 * One declarative argument of a plugin-declared slash command.
 *
 * Derived off `PluginCommandSpec['args']`, NOT aliased to the API's
 * `PluginCommandArg`: those are two deliberately different types. `PluginCommandArg`
 * is the MANIFEST shape and carries `optionsScript` — the plugin-relative script
 * path — which must never reach the client. The UI-facing spec collapses it to a
 * `dynamic` boolean. The API owns both (`pluginCommandArgSpecSchema`); only the
 * safe one is reachable from here.
 */
export type PluginCommandArgSpec = PluginCommandSpec['args'][number]

/**
 * The capability snapshot (`GET /rpc/capabilities/snapshot`) — ONE revision-stamped
 * document describing what a scope can do. Re-exported from its API owner for the
 * reason spelled out above: the plugin/agent/MCP records inside it are the SAME wire
 * records the managing endpoints return, and a restatement here would be free to drift
 * from them exactly when a plugin toggle depends on the two agreeing.
 */
/** The rule grammar the server sends: prefixes, effects, named classes, worked examples. */
export type RuleGrammar = CapabilitySnapshot['grammar']

// Composer tips derive their whole vocabulary from this snapshot too, in `./tips` —
// kept out of this barrel because it is a pinned god-file, and because the one VALUE
// they need must come from the api's narrow leaf rather than its client barrel.

export type { CapabilitySnapshot, CapabilityRuleChange, CapabilityToolSurface, ToolSurfaceDenial }

/**
 * The tool-GC report (`GET /rpc/tools/gc`). Re-exported from its API owner, never restated: the
 * whole point of the feature is that the count the pill shows and the count the run sends are the
 * same number, and a second declaration of its shape is the first step to them differing.
 */
export type { ToolGcReport }

/**
 * Single heuristic for "render this config field as a model picker": a key ending
 * in `_model` — e.g. agent-roles' `executor_model`.
 *
 * Structurally typed (`type?: string`) on purpose: it is a UI PRESENTATION rule,
 * not a wire type. It also still answers true for an explicit `type: 'model'`,
 * which the wire cannot currently deliver — `PLUGIN_CONFIG_TYPES` (owned by
 * `@localixai/plugin-sdk/manifest`) has no `'model'` member, so the backend's enum
 * would reject it. The check is kept as forward-compat; adding `'model'` for real is
 * an owner-side change.
 */
export function isModelConfigField(field: { key: string; type?: string }): boolean {
  return field.type === 'model' || field.key.endsWith('_model')
}

// One participant of a conversation plus the model it runs on, and the two functions that read
// it. Imported from the server's leaf rather than restated here: the shape crosses the wire
// unchanged, so a second declaration on this side could only ever drift from it.
import type { SessionAgentRoute, CapabilityRules } from '@localixai/api/client'

/**
 * One capability rule. A switch and a permission are the same statement: `tool:bash` over
 * resource `*` turns the tool off, the same action over `git push*` leaves it on and prompts.
 */
export interface CapabilityRule {
  action: string
  resource: string
  effect: 'allow' | 'ask' | 'deny'
  message?: string
}
export type CapabilityRuleSnapshot = Pick<
  CapabilityRules,
  'revision' | 'rules' | 'defaults' | 'registration'
>

/**
 * WHICH scope a capability read or write is about — global, a project, or an agent.
 *
 * One selector for all three, so a screen switches scope by changing this value rather than
 * by calling a different endpoint. An `agentId` wins over a `projectId`: an agent's rules
 * follow the agent wherever it runs, so they are not a per-project variant of anything.
 */
export interface CapabilityScope {
  projectId?: string | null
  agentId?: string | null
}
export type { SessionAgentRoute }
export {
  agentRoute,
  isMultiParticipant,
  sessionRoute,
  withRoute,
} from '@localixai/api/session-route'

/**
 * A sandboxed UI view declared by an enabled plugin (`GET /rpc/plugins/views`);
 * HTML fetched on open. The ONE plugin UI-surface contract — it always opens as a
 * work-item tab, so there is no mount-point choice to carry here.
 */
export interface PluginViewSpec {
  pluginName: string
  projectId: string
  id: string
  fullName: string
  title: string
  /** Explicit manifest opt-in for agent discovery. */
  agentDescription?: string
  /** Optional Lucide icon-name hint (host maps it to a glyph, else Puzzle). */
  icon?: string
}

// The store's session record and the room's floor mode live in their own module
// (`ui-session.ts`): the largest shape in this contract, and the one that grows with every
// strip above the composer. Re-exported so every existing import keeps resolving here.
export type { UiSession } from './ui-session'

export { sessionRef } from '@localixai/api/session-ref'
export type {} from '@localixai/api/client'
export type { ResourceBrowseResult, ResourceNode, ResourceNodeAction } from '@localixai/api/client'
