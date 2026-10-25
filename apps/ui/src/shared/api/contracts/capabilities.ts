import type {
  SkillRecord,
  SkillInput,
  SkillSummary,
  PluginRecord,
  PluginCommandSpec,
  MiniAppRecord,
  MiniAppCommandSpec,
  MarketplaceListing,
  PluginUpdatesResponse,
  PluginUpdateJob,
  UpdateMarketplaceResponse,
  AgentRecord,
  AgentRecordInput,
  AgentSummary,
  McpServer,
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

/** Result of a curator pass. */
export interface CuratorReport {
  active: number
  stale: number
  archived: number
  archivedNow: string[]
}

// ---- MCP ---------------------------------------------------------------------
/**
 * One owner: the API's zod contracts in `features/mcp/contracts.ts`, re-exported and never
 * restated. The UI only reads a server (its switch and what kind it is); adding, configuring and
 * removing one is the Store's.
 */
export type McpServerConfig = Partial<McpStdioConfig & McpHttpConfig>

/** A server as the UI reads it: the owner's record, config left un-narrowed. */
export type McpServerRecord = Omit<McpServer, 'config'> & {
  config: McpServerConfig
}

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
  MiniAppRecord,
  MiniAppCommandSpec,
  MarketplaceListing,
  PluginUpdatesResponse,
  PluginUpdateJob,
  UpdateMarketplaceResponse,
  AgentRecord,
  AgentRecordInput,
  AgentSummary,
}

/**
 * One declarative argument of a plugin-declared slash command.
 *
 * Derived off `PluginCommandSpec['args']`, NOT aliased to the API's
 * `MiniAppCommandArg`: those are two deliberately different types. `MiniAppCommandArg`
 * is the MANIFEST shape and carries `optionsScript` — the plugin-relative script
 * path — which must never reach the client. The UI-facing spec collapses it to a
 * `dynamic` boolean. The API owns both (`miniAppCommandArgSpecSchema`); only the
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

// One participant of a conversation plus the model it runs on, and the two functions that read
// it. Imported from the server's leaf rather than restated here: the shape crosses the wire
// unchanged, so a second declaration on this side could only ever drift from it.
import type {
  SessionAgentRoute,
  CapabilityRules,
  ModelChoiceView,
  JoinRoutesView,
  SessionModelChoicesView,
} from '@localixai/api/client'

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
export type CapabilityRuleSnapshot = Pick<CapabilityRules, 'revision' | 'rules' | 'defaults'>

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
export type { SessionAgentRoute, ModelChoiceView, JoinRoutesView, SessionModelChoicesView }
export {
  agentRoute,
  isMultiParticipant,
  sessionRoute,
  withRoute,
} from '@localixai/api/session-route'

/**
 * A sandboxed UI view declared by an enabled mini app; HTML fetched on open. It always opens as a
 * work-item tab. Re-exported from the API, never restated.
 */
export type { MiniAppViewSpec } from '@localixai/api/client'
