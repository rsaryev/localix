import type {
  SkillRecord,
  SkillInput,
  SkillSummary,
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
