import type {
  SkillSummary,
  PluginRecord,
  PluginCommandSpec,
  MiniAppRecord,
  MiniAppCommandSpec,
  MarketplaceListing,
  AgentSummary,
  CapabilitySnapshot,
  CapabilityRuleChange,
  CapabilityToolSurface,
} from '@localixai/api/client'

// ---- Skills -------------------------------------------------------------------
/** One owner, `features/chat/service/skills.ts`: re-exported, never restated. */
export type { SkillSummary }

// ---- Plugins, mini apps, agents ---------------------------------------------
/**
 * These wire records have ONE owner: the API's zod contracts, re-exported here
 * (type-only, so no zod reaches the client chunk) rather than restated. Each was
 * previously hand-copied into this file — and the copies had silently drifted:
 * `PluginProvides` had lost `lspServers`. Nothing —
 * not tsc, not a test — said a word, because a copy agrees with its original
 * right up until it doesn't. Re-export; never restate.
 */
export type {
  PluginRecord,
  PluginCommandSpec,
  MiniAppRecord,
  MiniAppCommandSpec,
  MarketplaceListing,
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

export type { CapabilitySnapshot, CapabilityRuleChange, CapabilityToolSurface }

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
