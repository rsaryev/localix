import type { ChangeCursorsTable, ChangeEventsTable } from './change-types'
import type { ColumnType, Generated } from 'kysely'

import type { ReasoningEffort } from './enums'
import type { CapabilityRuleTable, ConfigProposalsTable } from './capability-types'
import type { ExtensionContributionTable } from './extension-types'
import type {
  SemanticCollectionsTable,
  SemanticItemsTable,
  SemanticOutboxTable,
  SemanticSettingsTable,
} from './semantic-types'
import type {
  NotificationEventsTable,
  NotificationInboxTable,
  NotificationOpReceiptsTable,
} from './notification-types'
import type { CommentsTable, SessionPlansTable } from './plan-types'

export type { CommentsTable, SessionPlansTable }

// Row types for the capability policy tables live in their own module for size; they belong to
// this registry and are re-exported so every importer keeps taking table types from one place.
export type { CapabilityRuleTable, ConfigProposalsTable }
export type * from './notification-types'

// The vocabulary the columns below are derived from moved to `enums.ts` so this module
// erases at compile time. Re-exported here because ~1030 files import it from `db/types`.
export * from './enums'

export type ProviderAuthType = 'oauth-pkce' | 'api-key'
export type ProviderConnectionStatus = 'active' | 'pending' | 'revoked'
export type AgentMessageRole = 'user' | 'assistant' | 'tool'
/**
 * What a session IS, as an execution class.
 *
 * `chat` is the user's own conversation; `subagent` one delegated, one-shot piece of work;
 * `job` work the engine dispatched against a board task; `system` a passive log that never
 * runs a model. Conversation membership lives in `conversation_participants`, not in child sessions.
 */
export type AgentSessionKind = 'chat' | 'subagent' | 'job' | 'system'

export type AgentRuntimeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'

export interface ProviderConnectionsTable {
  id: string
  user_id: string
  provider_id: string
  provider_name: string
  label: string
  auth_type: ProviderAuthType
  status: ProviderConnectionStatus
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

/** How a key authenticates: a static API key, or an OAuth access/refresh token pair. */
export type KeyAuthType = 'api-key' | 'oauth'

export interface ProviderConnectionKeysTable {
  id: string
  connection_id: string
  user_id: string
  label: ColumnType<string, string | undefined, string | undefined>
  /** Secret-free discriminator; encrypted credential payload lives in the vault. */
  credential_type: ColumnType<KeyAuthType, KeyAuthType | undefined, KeyAuthType | undefined>
  /** Typed Vault item containing the credential payload. */
  vault_item_id: ColumnType<string | null, string | null | undefined, string | null | undefined>
  priority: ColumnType<number, number | undefined, number | undefined>
  enabled: ColumnType<number, number | undefined, number | undefined>
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

/** Non-secret catalog row for one item in the unified Localix Vault. */
export interface VaultItemsTable {
  id: string
  user_id: string
  kind: string
  name: string
  description: string
  folder_id: string | null
  backend: string
  external_ref: string | null
  source: string
  schema_version: number
  current_version: number
  favorite: number
  tags_json: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Immutable encrypted snapshots. Restore always appends another version. */
export interface VaultItemVersionsTable {
  id: string
  item_id: string
  version: number
  encrypted_payload: string | null
  payload_ref: string | null
  payload_schema: string
  reason: string
  created_at: string
  redacted_at: string | null
}

/** Stable config-facing aliases such as `OPENAI_API_KEY` → item id + field. */
export interface VaultAliasesTable {
  user_id: string
  alias: string
  item_id: string
  field: string
  created_at: string
}

export interface VaultFoldersTable {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  description: string
  created_at: string
  updated_at: string
}

/** Value-free reverse references used for usage UI and guarded deletion. */
export interface VaultItemBindingsTable {
  user_id: string
  item_id: string
  consumer_type: string
  consumer_id: string
  field: string
  label: string
  created_at: string
  updated_at: string
}

/** Metadata-only audit; secret material and request bodies never enter this table. */
export interface VaultAuditTable {
  id: Generated<number>
  user_id: string
  item_id: string | null
  actor_type: string
  actor_id: string
  consumer_type: string
  consumer_id: string
  operation: string
  result: string
  context_json: string
  created_at: string
}

export interface AgentSessionsTable {
  /** Transactional projection maintained by message insert/delete/move triggers. */
  message_count: ColumnType<number, undefined, never>
  id: string
  user_id: string
  /** Global sequence → the canonical `LOCALIX-<seq>` id. DB-assigned. */
  seq: ColumnType<number, number | undefined, never>
  title: string
  goal: ColumnType<string | null, string | null | undefined, string | null>
  previous_topic_summary: ColumnType<string | null, string | null | undefined, string | null>
  is_pinned: ColumnType<number, number | undefined, number | undefined>
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
  last_message_at: ColumnType<string, string | undefined, string | undefined>
  /** Execution backend kind: 'local' | 'ssh' | 'docker'. Defaults to 'local'. */
  execution_backend: ColumnType<string, string | undefined, string | undefined>
  /** SSH target 'user@host' or Docker container name. Null for local. */
  execution_target: string | null
  /** NOT NULL: every session belongs to a project (`projects/default-project.ts`). */
  project_id: string
  parent_session_id: string | null
  root_session_id: string | null
  session_kind: ColumnType<
    AgentSessionKind,
    AgentSessionKind | undefined,
    AgentSessionKind | undefined
  >
  runtime_status: ColumnType<
    AgentRuntimeStatus,
    AgentRuntimeStatus | undefined,
    AgentRuntimeStatus | undefined
  >
  source_tool_call_id: string | null
  /** Serialized SessionProvenance. Kept separate from source_tool_call_id UI correlation. */
  external_agent_provider: ColumnType<string | null, string | null | undefined, string | null>
  external_agent_session_key: ColumnType<string | null, string | null | undefined, string | null>
  invocation_json: ColumnType<string, string | undefined, string>
  /** JSON array of skill names pinned (warmed into context) for this session. */
  pinned_skills: ColumnType<string, string | undefined, string | undefined>
  /** JSON array of deferred tool names this session has activated; see the 20260818 migration. */
  activated_tools: ColumnType<string | null, string | null | undefined, string | null | undefined>
  /** Optional conversation description, independent of participant count. */
  description: string | null
  /** A group's avatar (an opaque ref: media id or emoji). Null = generated from the title. */
  avatar: string | null
  /** 1 = the participants were fixed before the conversation started; see the 20260925 migration. */
  /** When a delegated child was closed (`fork` action close): nothing wakes it after. Null = open. */
  closed_at: ColumnType<string | null, string | null | undefined, string | null | undefined>
  /** The session's permission mode (`capabilities/permission-modes.ts`); see the 20261003 migration. */
  permission_mode: ColumnType<string, string | undefined, string | undefined>
  /** The session's model choices per agent and for all agents (`session-model-choices.ts`). */
  model_choices: ColumnType<string | null, string | null | undefined, string | null | undefined>
  /** User-visible chat-message branch leaf (`agent_messages.id`). THE message tree's tip — the
   *  parallel `runtime_leaf_entry_id`, plus the `revision`/`next_entry_sequence` pair that versioned
   *  it, belonged to the write-only runtime tree and were dropped with it
   *  (`migrations/20260731T010000_drop_runtime_journal.ts`). */
  leaf_id: ColumnType<string | null, string | null | undefined, string | null | undefined>
  /** Soft-archive marker: ISO timestamp of when the chat was archived, or null = active.
   *  Archived chats are hidden from the sidebar by default; unarchive clears it. */
  archived_at: ColumnType<string | null, string | null | undefined, string | null | undefined>
  /**
   * Addressable agent name: the CANONICAL PATH of this session in its tree (`/root`,
   * `/root/audit_repo/probe_lint`). Unique per `root_session_id`; null only for sessions that
   * predate the column. Assigned once at insert and never updated — a name is an address, so
   * renaming it would silently invalidate every reference a running agent already holds (the
   * TITLE stays freely editable). Derivation and resolution live in
   * `features/agent-core/agent-task-name.ts`.
   */
  task_name: ColumnType<string | null, string | null | undefined, never>
}

/**
 * One participant of one session, and the route its turns run on.
 *
 * The party and its routing are the same table because they are the same fact. A session
 * used to carry a single {connection, model, effort} of its own, which can only describe a
 * conversation with ONE counterpart; a room with several agents needs one such triple each,
 * and a private chat is just the case where there is one row. Two tables — a member list
 * beside a routing table — could disagree, and the disagreements are both unrecoverable: a
 * route for someone who is not in the room, or a member with nowhere to run.
 *
 * The human is not a row. They are in every session by construction, and they do not run on
 * a model.
 */
/**
 * WHAT EXISTS TO RUN — one row per installed plugin, registry agent, agent provider or
 * MCP server. The registry half of the pair `capability_rule` completes: this says what
 * is here, that says what may run.
 *
 * Four tables held this and three of them were the same nine columns spelled three
 * times. What each kind needs beyond the shared skeleton lives in `config`, which this
 * table treats as opaque JSON — a plugin's declared settings, an MCP server's transport
 * and connection details. Columns for the latter would have sat null on three kinds out
 * of four, which is the generic-column trap this deliberately avoids.
 *
 * There is no `enabled`. Availability composes across global / project / agent and could
 * never be a boolean on a row keyed by project.
 */
export interface CapabilitySourceTable {
  contribution_revision: Generated<number>
  contribution_digest: Generated<string>
  /** Stable id. The primary key because an MCP server is addressed by it on the wire;
   *  the other kinds are addressed by (user, kind, project, name). */
  id: string
  user_id: string
  /** `plugin` | `agent` | `provider` | `mcp` — the capability kind this row installs. */
  kind: string
  /** '' = global (available everywhere); otherwise the project it is scoped to. */
  project_id: ColumnType<string, string | undefined, string | undefined>
  name: string
  /** The kind's own JSON. MAY CONTAIN SECRETS (a plugin's config values, an MCP header). */
  config: ColumnType<string, string | undefined, string | undefined>
  /** Where it came from: 'local', a git URL, or `imported:<tool>`. */
  source: ColumnType<string, string | undefined, string | undefined>
  created_at: string
  updated_at: string
}

export interface ConversationParticipantsTable {
  session_id: string
  agent_id: string
  /** Display snapshot; not a registry lookup key. */
  handle: string
  /** Join order, which is also speaking order for a group's serial rounds. */
  position: ColumnType<number, number | undefined, number | undefined>
  provider_connection_id: string | null
  model_id: string
  /** Set only when the user explicitly chooses this model; activity never changes it. */
  model_selected_at: ColumnType<string | null, string | null | undefined, string | null>
  reasoning_selected_at: ColumnType<string | null, string | null | undefined, string | null>
  reasoning_effort: ColumnType<
    ReasoningEffort,
    ReasoningEffort | undefined,
    ReasoningEffort | undefined
  >
}

export interface AgentMessagesTable {
  id: string
  session_id: string
  user_id: string
  sequence: number
  role: AgentMessageRole
  payload_json: string
  /** Generated visible-text projection used by history FTS; never written directly. */
  search_text: ColumnType<string, never, never>
  /** Branch tree: parent message id (previous entry on this branch); null at root. */
  parent_id: ColumnType<string | null, string | null | undefined, string | null | undefined>
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

/**
 * Transactional covering projection of `agent_messages.payload_json.usage`.
 * ChatRepository owns writes inside the surrounding message transaction.
 */
export interface AgentMessageUsageTable {
  message_id: string
  input_tokens: number | null
  output_tokens: number | null
  cached_input_tokens: number | null
  cache_write_tokens: number | null
  cache_write_1h_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  total_cost: number | null
  cost_source: 'actual' | 'estimated' | 'subscription' | null
}

/**
 * Exact tool I/O committed before a model-facing result may be bounded or
 * replaced by a recovery pointer. Session deletion cascades these artifacts.
 */
export interface ToolOutputArtifactsTable {
  user_id: string
  session_id: string
  tool_call_id: string
  tool_name: string
  participant: string | null
  content: string
  /** 'plain': `content` is the text. 'zstd': `content` is '' and `content_z` holds it compressed. */
  encoding: 'plain' | 'zstd'
  content_z: Uint8Array | null
  input_json: string
  is_error: number
  byte_length: number
  created_at: string
  updated_at: string
}

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted'

/**
 * One invocation of an agent runtime against a durable session.
 *
 * The last surviving table of the runtime journal, kept because it is the only evidence that a chat
 * run was in flight when the process died: the boot sweep reclassifies `running` rows and the
 * transcript announces the restart to the user. Its columns that named rows in the dropped tables
 * (`trigger_entry_id`, `start_revision`, `end_revision`, `next_event_sequence`) and its never-written
 * `usage_json` went with them — see `migrations/20260731T010000_drop_runtime_journal.ts`.
 */
export interface AgentRunsTable {
  id: string
  session_id: string
  /** The participant whose run this is — in a conversation, which agent was interrupted. */
  agent_id: string
  status: AgentRunStatus
  provider_id: string
  model_id: string
  credential_id: string | null
  adapter: string
  adapter_version: string
  /** Classified failure kind, so failures are queryable without parsing `error_json`. */
  error_code: string | null
  error_json: string | null
  started_at: string
  finished_at: string | null
}

/**
 * The MODEL's view state for one run, keyed by that run's assistant row: the turn's runtime
 * context and, when the run took one, the checkpoint that froze the view. Never shipped to a
 * client — the transcript is the product, this is how the model reads it.
 */
export interface AgentMessageModelContextTable {
  message_id: string
  session_id: string
  turn_context_json: string | null
  checkpoint_json: string | null
  updated_at: string
}

/** Durable ingress queue behind an active chat run. The payload is a versioned,
 * host-owned PendingTurn envelope; leases survive process death and expire. */
export interface AgentQueueItemsTable {
  sequence: Generated<number>
  id: string
  user_id: string
  session_id: string
  priority: number
  /** What the row is; every kind drains through the durable turn queue. */
  kind: 'user' | 'wake'
  payload_json: string
  state: ColumnType<'pending' | 'leased', 'pending' | 'leased' | undefined, 'pending' | 'leased'>
  lease_owner: string | null
  lease_expires_at: string | null
  /** Stable seed for deterministic transcript message ids on retry/restart. */
  delivery_key: string
  queued_at: string
  /** The band it was claimed in with other items; null when claimed alone. */
  batch_id: ColumnType<string | null, string | null | undefined, string | null>
}

export interface SqliteMasterTable {
  type: string
  name: string
  tbl_name: string
  rootpage: number
  sql: string | null
}

export interface AgentMemoryTable {
  id: string
  user_id: string
  /** '' = global (every session); otherwise scoped to a project id. */
  project_id: ColumnType<string, string | undefined, string | undefined>
  key: string
  value: string
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

export interface UserViewStateTable {
  user_id: string
  kind: 'surface' | 'draft'
  key: string
  value_json: string
  revision: number
  updated_at: string
}

export interface UserProfilesTable {
  user_id: string
  /** JSON string — UI-only settings (font, etc.), not injected into agent context */
  ui_settings: string | null
  /** JSON string — global runtime settings */
  agent_settings: string | null
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

export interface ProjectsTable {
  id: string
  /** Global sequence → the canonical `PRJ-<seq>` id. */
  seq: ColumnType<number, number | undefined, never>
  user_id: string
  name: string
  working_dir: string
  /** JSON string — per-project settings (custom system prompt, model overrides, allowed tools, etc.) */
  settings: string | null
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
  /** Soft-deleted at this time; null = live. Deletion never removes the row (see the schema). */
  deleted_at: ColumnType<string | null, string | null | undefined, string | null>
}

/**
 * Usage/cost ledger — chat turns are keyed by assistant message; repeated
 * auxiliary calls accumulate into stable kind/routing buckets. Powers the spend
 * dashboard and the auxiliary part of the authoritative session total.
 */
export interface UsageEventsTable {
  message_id: string
  session_id: string
  root_session_id: string | null
  user_id: string
  provider_connection_id: string | null
  provider_id: string | null
  model_id: string
  created_at: ColumnType<string, string | undefined, never>
  input_tokens: ColumnType<number, number | undefined, number | undefined>
  output_tokens: ColumnType<number, number | undefined, number | undefined>
  cache_read_tokens: ColumnType<number, number | undefined, number | undefined>
  cache_write_tokens: ColumnType<number, number | undefined, number | undefined>
  cache_write_1h_tokens: ColumnType<number, number | undefined, number | undefined>
  reasoning_tokens: ColumnType<number, number | undefined, number | undefined>
  total_tokens: ColumnType<number, number | undefined, number | undefined>
  cost_usd: ColumnType<number, number | undefined, number | undefined>
  cost_source: ColumnType<string, string | undefined, string | undefined>
  finish_reason: ColumnType<string | null, string | null | undefined, string | null | undefined>
  duration_ms: ColumnType<number | null, number | null | undefined, number | null | undefined>
  /** Denormalized snapshot of the API key that produced this request. */
  key_id: ColumnType<string | null, string | null | undefined, string | null | undefined>
  key_label: ColumnType<string | null, string | null | undefined, string | null | undefined>
  key_masked: ColumnType<string | null, string | null | undefined, string | null | undefined>
  /** The party member whose turn this was — a room's spend is per participant, not per session. */
  agent_id: ColumnType<string | null, string | null | undefined, string | null | undefined>
}

/** Transport kind for an MCP server: local stdio process, remote HTTP, or WebSocket. */
export type McpTransport = 'stdio' | 'http' | 'ws'

/**
 * Skill usage telemetry for the skills curator. Skills live on disk as SKILL.md
 * directories — this row tracks only usage (`get_count` / `last_used_at`),
 * the user's pin (exempts the skill from curator auto-archival) and the
 * curator's archive marker. Keyed by (user, project, skill name, scope).
 * `project_id = ''` is the independent no-project session scope.
 */
export interface SkillUsageTable {
  id: string
  user_id: string
  project_id: ColumnType<string, string | undefined, string | undefined>
  skill_name: string
  scope: ColumnType<string, string | undefined, string | undefined>
  get_count: ColumnType<number, number | undefined, number | undefined>
  last_used_at: ColumnType<string | null, string | null | undefined, string | null | undefined>
  pinned: ColumnType<number, number | undefined, number | undefined>
  archived_at: ColumnType<string | null, string | null | undefined, string | null | undefined>
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

/**
 * Per-tool call counters, keyed by (user, project, tool name). `project_id = ''` is the
 * no-project session scope, exactly as in {@link SkillUsageTable}.
 *
 * Deliberately carries no `source`/`origin_id`: whether a name is a builtin, a plugin tool or an
 * MCP tool belongs to the CURRENT capability surface and is resolved there at read time. A copy
 * here would be a second encoding of a fact that changes under it.
 *
 * `first_seen_at` is when the tool first became AVAILABLE to the model, not when this row was
 * written — the distinction is what makes "never used" mean anything for a freshly installed
 * plugin.
 */
export interface ToolUsageTable {
  id: string
  user_id: string
  project_id: ColumnType<string, string | undefined, string | undefined>
  tool_name: string
  call_count: ColumnType<number, number | undefined, number | undefined>
  error_count: ColumnType<number, number | undefined, number | undefined>
  first_seen_at: string
  last_used_at: ColumnType<string | null, string | null | undefined, string | null | undefined>
  created_at: ColumnType<string, string | undefined, never>
  updated_at: ColumnType<string, string | undefined, string | undefined>
}

export interface AppDatabase {
  provider_connections: ProviderConnectionsTable
  provider_connection_keys: ProviderConnectionKeysTable
  vault_items: VaultItemsTable
  vault_item_versions: VaultItemVersionsTable
  vault_aliases: VaultAliasesTable
  vault_folders: VaultFoldersTable
  vault_item_bindings: VaultItemBindingsTable
  vault_audit: VaultAuditTable
  agent_sessions: AgentSessionsTable
  participant_lane_snapshots: {
    user_id: string
    session_id: string
    agent_id: string
    boundary_marker: string
    snapshot_json: string
  }
  conversation_participants: ConversationParticipantsTable
  capability_rule: CapabilityRuleTable
  config_proposals: ConfigProposalsTable
  capability_policy_revision: { user_id: string; agent_id: string; revision: number }
  capability_policy_binding: {
    user_id: string
    contribution_id: string
    agent_id: string
    contribution_revision: number
    policy_revision: number
  }
  agent_messages: AgentMessagesTable
  agent_message_usage: AgentMessageUsageTable
  agent_message_model_context: AgentMessageModelContextTable
  tool_output_artifacts: ToolOutputArtifactsTable
  agent_runs: AgentRunsTable
  agent_queue_items: AgentQueueItemsTable
  agent_delivery_receipts: AgentDeliveryReceiptsTable
  agent_memory: AgentMemoryTable
  user_view_state: UserViewStateTable
  semantic_settings: SemanticSettingsTable
  semantic_collections: SemanticCollectionsTable
  change_events: ChangeEventsTable
  change_cursors: ChangeCursorsTable
  semantic_items: SemanticItemsTable
  semantic_outbox: SemanticOutboxTable
  user_profiles: UserProfilesTable
  sqlite_master: SqliteMasterTable
  projects: ProjectsTable
  usage_events: UsageEventsTable
  capability_source: CapabilitySourceTable
  extension_contribution: ExtensionContributionTable
  skill_usage: SkillUsageTable
  tool_usage: ToolUsageTable
  triggers: TriggersTable
  work_records: WorkRecordsTable
  session_plans: SessionPlansTable
  comments: CommentsTable
  ref_sequence_counters: RefSequenceCountersTable
  agent_external_session_keys: AgentExternalSessionKeysTable
  notification_events: NotificationEventsTable
  notification_inbox: NotificationInboxTable
  notification_op_receipts: NotificationOpReceiptsTable
}

/**
 * "This delivery was admitted once, ever" — kept past the queue row's acknowledgement, which is
 * what makes a replayed report a duplicate rather than a second turn. Pruned after
 * `created_at` leaves the retention horizon; recovery never looks further back than that.
 */
export interface AgentDeliveryReceiptsTable {
  delivery_key: string
  user_id: string
  session_id: string
  created_at: string
}

/** Atomic allocator state for globally unique canonical refs (LOCALIX/PRJ/LX). */
export interface RefSequenceCountersTable {
  scope: string
  last_value: number
}

/** Durable idempotency key for externally-driven chat sessions. */
export interface AgentExternalSessionKeysTable {
  user_id: string
  external_key: string
  /** Nullable only while the owning transaction creates the claimed session. */
  session_id: string | null
}

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null | undefined>

/**
 * One piece of background work a session owns — a detached job, a monitor, a promoted call —
 * and how it ended (`features/work`). The row is what survives a restart: the process that ran
 * the work does not, so a row still `running` at boot is the evidence that it was lost.
 */
export interface WorkRecordsTable {
  id: string
  user_id: string
  session_id: string
  agent_id: Nullable<string>
  /** The id the agent and the user see (`bg-3`, `mon-1`); unique and never reused per session. */
  display_id: string
  kind: 'job' | 'monitor' | 'stream' | 'promoted' | 'subagent'
  label: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'lost'
  exit_code: Nullable<number>
  tool_call_id: string
  /** The assistant message holding the work's transcript item. */
  message_id: Nullable<string>
  terminal_id: Nullable<string>
  /** The delegated child session a `subagent` record stands for. */
  child_session_id: Nullable<string>
  /** Events a monitor has reported, and the latest — what the composer row shows it seeing. */
  event_count: ColumnType<number, number | undefined, number>
  last_event: Nullable<string>
  last_event_at: Nullable<string>
  started_at: string
  ended_at: Nullable<string>
}

/**
 * One durable trigger: WHEN something wakes a session, and whether the last wake landed
 * (`features/triggers`). `kind` owns the timing (`spec_json`); `action` owns what a fire does
 * (`payload_json`) — a loop's prompt and target are the loop action's, not the scheduler's.
 */
export interface TriggersTable {
  id: string
  user_id: string
  session_id: string
  owner_kind: 'agent' | 'user' | 'plugin' | 'system'
  owner_agent_id: Nullable<string>
  owner_ref: Nullable<string>
  action: string
  kind: string
  state: ColumnType<
    'armed' | 'held' | 'firing' | 'ended',
    'armed' | 'held' | 'firing' | 'ended' | undefined,
    'armed' | 'held' | 'firing' | 'ended'
  >
  hold_reason: Nullable<'busy' | 'rate-limited'>
  end_reason: Nullable<string>
  spec_json: string
  payload_json: string
  next_due_at: Nullable<string>
  fire_seq: ColumnType<number, number | undefined, number>
  fire_count: ColumnType<number, number | undefined, number>
  last_fired_at: Nullable<string>
  last_status: Nullable<'ok' | 'error'>
  last_error: Nullable<string>
  created_at: ColumnType<string, string, never>
  updated_at: string
}
