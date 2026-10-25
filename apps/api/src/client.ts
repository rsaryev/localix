export type { App } from './app'
export {
  LOCALIX_API_PRODUCT_ID,
  LOCALIX_API_PROTOCOL_VERSION,
  type LocalixRuntimeInfo,
} from './lib/runtime-protocol'

// Value re-export (single source of truth): the largest request body the server accepts. The UI
// needs the NUMBER, not just the rule — a 413 from Bun carries an empty body, so the only way a user
// learns why a drop failed is a client-side check that names the limit.
export { MAX_REQUEST_BODY_BYTES, formatByteLimit } from './lib/request-limits'

// The header the browser transport sends on every write, so the server's local-origin guard and
// the client cannot spell it differently (`lib/client-header.ts`).
export { LOCALIX_CLIENT_HEADER, LOCALIX_CLIENT_HEADER_VALUE } from './lib/client-header'

export type {
  AgentStreamEvent,
  DirListing,
  DirEntry,
  FileSearchResult,
  FileSearchEntry,
  FileSearchMode,
  FileSearchType,
  FileContentMatch,
  FileContentSearchResult,
  FileContentResponse,
  FileWriteResponse,
  FileEntryResponse,
  FileDeleteResponse,
  FileUndoResponse,
  MessageMutationResponse,
  MessageToolDetails,
  MessageAttachment,
  MessageBinding,
  MessageContextBinding,
  MessageInvocationBinding,
  SessionLoopSummary,
  SessionWork,
  SessionQueueItem,
  QueueClearResult,
  QueuePromoteResult,
  QueueRemovalResult,
  WakeSource,
  PendingHitlInteraction,
  PersistedMessage,
  RollbackResponse,
  SessionBranchNode,
  SessionBranchTree,
  SessionAgentRoute,
  SessionModelChoicesView,
  ModelChoiceView,
  JoinRoutesView,
  SessionDetail,
  SessionModelView,
  SessionTerminalWait,
  SessionSourceRuntime,
  SessionSummary,
  LastMessagePreview,
  SessionTiming,
  MessageTiming,
  MessageProviderMeta,
  ToolTiming,
} from './features/chat/contracts'
export { sessionRef } from './contracts/session-ref'
// The skills READ record and its WRITE payload — one owner, so no client can read
// back a field it has no way to write. (Type-only module: nothing lands in the bundle.)
export type { SkillRecord, SkillInput } from './features/chat/service/skills'
// The CATALOG projection of a skill — what the capability snapshot carries. Bodies
// stay out of it; a client that needs one reads the full record for that skill.
export type { SkillSummary } from './features/chat/contracts/skills'
// ONE capability change — the unit `POST /rpc/capabilities/rules/apply` applies.
export type {
  CapabilityRuleChange,
  CapabilityRulesApplyRequest,
} from './features/capabilities/contracts'
export type { HistorySearchHit } from './features/chat/repository-types'
// A plan version and a comment, as `/rpc/sessions/:id/plans` and `/rpc/comments` answer them.
export type { SessionPlan, PlanStatus, ImplementationMode } from './features/plans/contracts'
// A piece of unfinished work the person can Continue, as `/rpc/sessions/:id/resume` answers it.
export type { ResumePoint } from './features/resume/contracts'
export type { CommentView, CommentStatus } from './features/comments/contracts'
// What waits on the person, as `/rpc/attention` and the `attention.updated` frame carry it.
export type { AttentionItem, AttentionKind } from './features/attention/contracts'

export {
  COMPLETION_INLINE_CONTENT_MAX,
  COMPLETION_REFERENCE_LIMIT,
  INLINE_COMPLETION_SURFACE_IDS,
  type ChatInlineCompletionPayload,
  type CompletionReference,
  type InlineCompletionContextRequest,
  type InlineCompletionRequest,
  type InlineCompletionResult,
  type InlineCompletionResponse,
  type InlineCompletionOutcome,
  type InlineCompletionSurfaceId,
  type InlineCompletionSurfacePayloads,
} from './features/inline-completion/contracts'

// The shared built-in slash-command catalog — one source of truth for command
// names + descriptions across every surface that shows or runs a command.
export { SLASH_COMMANDS, BUILTIN_COMMAND_NAMES } from './features/chat/slash-catalog'
export type { SlashCommandSpec } from './features/chat/slash-catalog'

// The marks a participant may put on a message. One owner: the tool's schema and the picker the
// person taps are the same six, so a chip a person adds and a chip an agent adds mean the same.
export {
  MESSAGE_REACTIONS as AGENT_REACTIONS,
  type MessageReaction as AgentReaction,
} from './features/chat/message-reactions'
// How large a conversation's party may be — enforced by the server, respected by the composer.
// Dependency-free model assignment catalog, importable from any client bundle.
export {
  AUX_MODEL_TASKS,
  MODEL_TASKS,
  MODEL_ROUTING_TASKS,
  isAuxTaskKey,
  isModelRoutingTaskEnabled,
  isModelRoutingTaskKey,
} from './contracts/model-task-catalog'
export type {
  AuxModelTask,
  AuxTaskKey,
  ModelTaskKey,
  ModelRoutingTaskKey,
  ModelTask,
  ModelRoutingTask,
} from './contracts/model-task-catalog'

export type {
  LspServerState,
  LspServerStatus,
  LspDiagnostic,
  LspRelatedInformation,
  LspPosition,
  LspHoverInfo,
  LspCompletionItem,
  LspSignatureHelp,
  LspInlayHint,
  LspColorInfo,
  LspDocumentSymbol,
  LspDocumentHighlight,
  LspRange,
  LspCodeAction,
  LspCodeActionCommand,
  CodeLocation,
  CodeReference,
  WorkspaceSymbol,
  RenamePrepare,
  RenameResult,
} from './features/lsp'

// Plugins and mini apps: their records, presentation helpers and store (`client-extensions.ts`).
export * from './client-extensions'

export type {
  AgentRecord,
  AgentRecordInput,
  AgentSummary,
  ListAgentsResponse,
  DuplicateAgentRequest,
} from './features/agents/contracts'

export type {
  ProviderConnection,
  ProviderConnectionKey,
} from './features/provider-connections/contracts'
export type { CatalogResponse } from './features/catalog/contracts'
export type {
  Project,
  CreateProjectRequest,
  ResolveProjectByPathRequest,
  ResolveProjectByPathResponse,
  UpdateProjectRequest,
  ProjectSettings,
  ProjectSettingsPatch,
  PermissionRule,
  ContextRef,
  ContextRefExpansion,
  ExpandRefsRequest,
  ExpandRefsResponse,
} from './features/projects/contracts'
export { PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS } from './features/projects/contracts'
export type {
  UserProfile,
  UpdateUserProfileRequest,
  UiSettings,
  UiSettingsPatch,
  AgentSettings,
  AgentSettingsPatch,
} from './features/user/contracts'
export {
  AGENT_SETTINGS_MAX_SERIALIZED_CHARS,
  UI_SETTINGS_MAX_SERIALIZED_CHARS,
} from './features/user/profile-limits'
export type {
  EffectiveConfigReport,
  EffectiveConfigQuery,
  ConfigProvenance,
  ConfigScope,
  ConfigDiagnostic,
  ConfigDiagnosticSeverity,
  ConsumerResolution,
  PermissionSummaryEntry,
  ToolSurface,
  ToolSurfaceDenial,
  ReloadClass,
} from './features/effective-config/contracts'
export type { ToolMeta } from './features/tools/routes'
// The ONE versioned capability projection (`GET /rpc/capabilities/snapshot`) every
// client surface reads — see contracts/capability-snapshot.ts for why it is one
// document rather than four endpoints.
export type { CapabilityRules, CapabilitySnapshotQuery } from './features/capabilities/contracts'
export type { CapabilitySnapshot, CapabilityToolSurface } from './contracts/capability-snapshot'
// `TIP_SIGNALS` is a VALUE the browser needs, so it does NOT belong here: this barrel
// is type-only on purpose, and one value re-export from it drags the module it lives in
// — and everything that module imports — into the web bundle. Exporting the tip
// vocabulary from here pulled `features/chat/contracts` and the mini-app-sdk BACKEND into
// the browser graph, where `node:dns` and `node:path` are externalized and blow up at
// runtime. It is served from the `@localixai/api/tip-contracts` leaf instead.
export type { PublishRegistrationPolicy } from './features/agents/registration-policy'
// The tool-GC report (`GET /rpc/tools/gc`). Separate from the snapshot on purpose — see
// features/tools/gc-report.ts.
export type { ToolCounts, ToolGcReport } from './features/tools/gc-report'
export type { ToolGcReason, ToolGcSuggestion } from './features/agent-core/tool-gc'
// Domain plugin contracts are intentionally not re-exported by the host client.
export type {
  CreateSecretRequest,
  RotateSecretRequest,
  SecretBinding,
  SecretMeta,
  UpdateSecretMetadataRequest,
  VaultAuditEntry,
  VaultItemSource,
  VaultItemType,
  VaultVersionMeta,
} from './features/secrets/contracts'
export { VAULT_ITEM_TYPES, VAULT_ITEM_TYPE_DEFINITIONS } from './features/secrets/contracts'
export type {
  ResourceBrowseGroup,
  ResourceBrowseResult,
  ResourceNode,
  ResourceNodeAction,
  ResourceExpansion,
} from './features/agent-core/resource-refs/provider'
export type { SearchHit, SearchQuery, SearchProvider } from './features/agent-core/search/provider'
export type {
  SearchRequest,
  SearchResponse,
  SearchGroup,
  SearchErrorResponse,
} from './features/search/contracts'
export type {
  UsageStatRow,
  UsageSummary,
  UsageTrendPoint,
  UsageOverview,
  UsageLogRow,
  UsageLogsPage,
  UsageKeys,
} from './features/usage/repository'
export { USAGE_AUXILIARY_KINDS, USAGE_KIND_LABELS } from './features/usage/usage-types'
export type { UsageKindKey } from './features/usage/usage-types'

export type {
  AskToolAnswer,
  AskToolDetails,
  AskToolInput,
  AskToolOption,
  AskToolPayload,
  AskToolQuestion,
  AskToolRequest,
  AskToolResponse,
} from './features/agent-core/tools/hitl/ask'

export type {
  ConfirmToolPayload,
  ConfirmToolRequest,
  ConfirmToolResponse,
} from './features/agent-core/tools/hitl/confirm'

export type {
  ConfigChangePayload,
  ConfigChangeRequest,
  ConfigChangeResponse,
} from './features/agent-core/tools/hitl/config-change'

export type * from './features/agent-core/tools/hitl/mcp-elicitation'
export type * from './features/agent-core/tools/hitl/mcp-elicitation-content'

export type {
  McpServer,
  McpStdioConfig,
  McpHttpConfig,
  McpOAuthConfig,
} from './features/mcp/contracts'

export type {
  CreateTerminalRequest,
  TerminalInfo,
  TerminalClientFrame,
  TerminalServerFrame,
} from './features/terminal/contracts'

export type {
  PreviewAction,
  PreviewCommand,
  PreviewCommandResult,
  PreviewConsoleEntry,
  PreviewSnapshot,
  PreviewImage,
  PreviewSendOutcome,
} from './features/agent-core/tools/preview/preview-control'

export type { ShellCommandStatusDto } from './features/shell-command/contracts'
export type { PruneResult } from './features/storage/service'
export type { StorageUsage } from './db/storage'
export type {
  SemanticCollectionStatus,
  SemanticStatus,
  SearchStrategyNote,
} from './features/embeddings/contracts'
export type {
  InstallJob,
  LocalModelEntry,
  LocalModelKind,
  LocalModelSpec,
  LocalModelsStatus,
} from './features/local-models/contracts'

export type { EditPrediction } from './features/edit-prediction/contracts'

export { contextExclusionsSchema } from './contracts/context-exclusion-schema'

export type {
  ViewStateKind,
  ViewStateAddress,
  ViewStateValues,
  ViewStateSnapshot,
  ViewStateWrite,
  ViewStateWriteResult,
} from './features/user/view-state-contracts'
