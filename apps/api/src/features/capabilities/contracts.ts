import { z } from 'zod'
import { capabilityRuleSchema } from './rule-schema'
export { capabilityRuleSchema } from './rule-schema'

import { toolSurfaceSchema } from '../effective-config/contracts'
import { agentSummarySchema } from '../agents/contracts'
import { mcpServerSchema } from '../mcp/contracts'
import {
  pluginCommandSpecSchema,
  pluginRecordSchema,
  pluginViewSpecSchema,
} from '../plugins/contracts'
import { skillSummarySchema } from '../chat/contracts/skills'
import { toolMetaSchema } from '../tools/catalog'
import { composerTipSchema } from './tip-contracts'

/**
 * Wire contract for `GET /rpc/capabilities/snapshot` — ONE versioned answer to
 * "what can this scope do right now", composed by ONE resolver.
 *
 * Every field here used to be its own endpoint, and the clients that needed two of
 * them fetched two and re-derived the shared fact ("is this plugin enabled") twice.
 * That is how disabling a plugin could update the plugin list while leaving its tools
 * listed as enabled and its views mounted: two projections, two refresh keys, one of
 * them not advancing. Fields are composed from their owning features' schemas — never
 * restated — so a snapshot cannot describe a plugin/agent/MCP record differently from
 * the endpoint that manages it.
 */

/**
 * WHICH scope a read or a write is about — the one selector every capability route takes.
 *
 * Three scopes, one shape: no field is global, a `projectId` is that project, an
 * `agentId` is that agent. An agent ID selects the stored scope (see `storedScope`), because
 * an agent's rules follow the agent wherever it runs and are not a per-project variant.
 */
export const capabilityScopeSchema = z.object({
  /** '' or absent = the no-project (global) scope. */
  projectId: z.string().optional(),
  /** Registry-issued AgentId. Present = the scope is that agent. */
  agentId: z.string().optional(),
})
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>

export const capabilitySnapshotQuerySchema = capabilityScopeSchema.extend({})
export type CapabilitySnapshotQuery = z.infer<typeof capabilitySnapshotQuerySchema>

/**
 * The tool surface plus the descriptor metadata a UI needs to render it. Extends the
 * effective-config surface rather than paraphrasing it: `enabled`/`disabled` come from
 * the same `computeToolSurface` the diagnostics report uses, so a tool cannot be
 * "enabled" in one view and denied in the other.
 */
export const capabilityToolSurfaceSchema = toolSurfaceSchema.extend({
  /** Every tool the scope knows about, including ones denied above. */
  catalog: z.array(toolMetaSchema),
  /** Category id → display label; the backend owns this vocabulary and its order. */
  categoryLabels: z.record(z.string(), z.string()),
  /**
   * MCP tools this scope would send, grouped by server, with the names the model actually sees.
   *
   * A SIBLING of `catalog`, deliberately not merged into `enabled`. The Tools settings screen owns
   * builtin + plugin toggles through `disabledTools`; MCP owns its own per-server tool filters.
   * Merging the two lists would put a row in the Tools tab whose switch does not live there.
   *
   * It exists because a count taken from `enabled.length` alone is WRONG by exactly this many:
   * MCP tools are gathered per run, so the surface the model receives is builtins + plugin tools +
   * these. Shipping the count without them is the single most common failure of this feature
   * elsewhere: a surface that reports "128 tools" while the picker lists 118.
   *
   * Read from the connection cache only; nothing here triggers a connect.
   */
  mcp: z.array(
    z.object({
      serverId: z.string(),
      serverName: z.string(),
      /** Post-filter, post-namespacing, post-disambiguation — the names on the wire. */
      tools: z.array(z.string()),
    }),
  ),
  /**
   * Enabled servers with no usable cache entry, BY NAME.
   *
   * Named rather than omitted, and that is the whole point: their tool count is unknown, so a
   * consumer must be able to say "N tools, plus 2 servers not yet connected" instead of quietly
   * presenting a short number as complete. Omitting them would make the estimate lie in the one
   * direction that matters.
   */
  mcpUnprobedServers: z.array(z.string()),
})
export type CapabilityToolSurface = z.infer<typeof capabilityToolSurfaceSchema>

/**
 * The composer-tip wire shape lives in its own module (`tip-contracts.ts`) and is
 * re-exported here so every consumer still takes the capability vocabulary from one
 * import. A tip is composed FROM this document; it is not part of describing what a
 * scope can do, and the two change for different reasons.
 */
export {
  TIP_SIGNALS,
  tipSignalSchema,
  composerTipGateSchema,
  composerTipActionSchema,
  composerTipSchema,
} from './tip-contracts'
export type { TipSignal, ComposerTipGate, ComposerTipAction, ComposerTip } from './tip-contracts'

export const capabilitySnapshotSchema = z.object({
  /**
   * The process-wide capability revision this snapshot was computed at (see
   * `capabilities/revision.ts`). A consumer holding an older number knows it is
   * behind; one holding the same number knows a refetch would change nothing.
   */
  revision: z.number(),
  /** The exact scope described. Echoed so a late response can be matched to its request. */
  scope: z.object({
    projectId: z.string(),
    agentId: z.string().nullable(),
  }),
  /** Installed plugins — including disabled ones and ones with no UI contribution. */
  plugins: z.array(pluginRecordSchema),
  tools: capabilityToolSurfaceSchema,
  /** Sandboxed UI views of enabled plugins — each opens as a work-item tab. */
  views: z.array(pluginViewSpecSchema),
  /** Managed sub-agents visible to the scope, with their enable state. */
  agents: z.array(agentSummarySchema),
  /** Slash commands declared by enabled plugins, flattened + namespaced. */
  commands: z.array(pluginCommandSpecSchema),
  /** MCP servers visible to the scope, with their enable state. */
  mcp: z.array(mcpServerSchema),
  /**
   * Skills visible to the scope, as CATALOG summaries — no bodies. The editor reads
   * a skill's content when it opens one; see `skillSummarySchema`.
   */
  skills: z.array(skillSummarySchema),
  /**
   * What the composer teaches while a run streams, DERIVED from the fields above.
   *
   * It is a projection of this same document rather than a list the client keeps,
   * for the reason every other field here is composed once on the server: the client
   * that wrote its own tips had to name plugins ("the Playwright plugin"), tools
   * ("bash") and settings pages, none of which it can know are present. Deriving them
   * here means the pool follows what the scope actually has.
   */
  tips: z.array(composerTipSchema),
  /**
   * The RULE GRAMMAR — everything a person needs in order to write one, sent rather than
   * hardcoded on the client.
   *
   * The editor could only suggest values it had already seen in the list, and its legend and
   * worked examples were prose in a React file. So a class the engine understood was
   * invisible, and a kind added on the server was explained nowhere. Shipping the grammar
   * means the screen learns what the server learns, and nothing on the client names a
   * prefix, a class or an effect in its own right.
   */
  grammar: z.object({
    /** What each action prefix addresses: `tool:`, `mcp:`, `invocation:`… */
    kinds: z.array(z.object({ prefix: z.string(), label: z.string(), hint: z.string() })),
    /** What each effect does to a call. */
    effects: z.array(z.object({ value: z.enum(['allow', 'ask', 'deny']), hint: z.string() })),
    /** The named resource classes, with the kinds whose rules can name each. */
    classes: z.array(
      z.object({ value: z.string(), hint: z.string(), appliesTo: z.array(z.string()) }),
    ),
    /** Worked rules, written exactly as they are stored. */
    examples: z.array(
      z.object({
        action: z.string(),
        resource: z.string(),
        effect: z.enum(['allow', 'ask', 'deny']),
        note: z.string(),
      }),
    ),
  }),
})
export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>

/**
 * ONE capability change — a rule, said plainly.
 *
 * There is no `enabled` on this wire and no per-kind union, because a switch was never a
 * second kind of thing: turning a skill off IS `skill:<name>` over `*` with effect `deny`.
 * Sending a boolean instead meant the server carried a second vocabulary and translated it
 * per kind, and each kind had drifted into its own idea of what "on" writes. The four
 * settings tabs still render a switch; that sugar lives in the client now, which is the only
 * place it can be wrong without the run and the screen disagreeing.
 *
 * `effect` is the ABSOLUTE desired state, never a flip, so a retried request is idempotent
 * and two clients cannot toggle past each other. `default` is the fourth answer and is not
 * `allow`: it removes the row, so the item falls back to its kind's default and then to its
 * own trust gate — which is what keeps a dropped-in plugin inert until somebody says yes.
 */
export const capabilityRuleChangeSchema = z.object({
  /** `tool:bash`, `skill:deploy`, `mcp:github`, `mcp:github/create_pr`, `plugin:office`… */
  action: z.string().min(1).max(200),
  /** `*` is the capability itself; anything else narrows it to particular arguments. */
  resource: z.string().min(1).max(400).default('*'),
  effect: z.enum(['allow', 'ask', 'deny', 'default']),
})
export type CapabilityRuleChange = z.infer<typeof capabilityRuleChangeSchema>

/** How many changes one request may carry — a bulk edit, not an import channel. */
export const MAX_CAPABILITY_CHANGES = 200

/**
 * Wire contract for `POST /rpc/capabilities/rules/apply` — the ONE way to change what a
 * scope permits, answering with the same document `GET /rpc/capabilities/snapshot` returns.
 *
 * Changes arrive as a LIST because editing is genuinely a set operation (a screen flips
 * several rows in a row), and because one request that applies them all cannot leave the
 * scope halfway between two intended states. They are applied in ONE read-modify-write of
 * the scope's ordered list, whatever kinds they span.
 *
 * Answering with the snapshot is the point: a mutation used to be followed by a second
 * request for the document it had just invalidated, and the pair could interleave with
 * another client's. One request in, one authoritative document out.
 *
 * This is a PATCH by (action, resource). To replace a scope's whole ordered list — which is
 * what the rules editor does, because order is the semantics — use `PUT /rules`.
 */
export const capabilityRulesApplySchema = capabilityScopeSchema.extend({
  changes: z.array(capabilityRuleChangeSchema).min(1).max(MAX_CAPABILITY_CHANGES),
})
export type CapabilityRulesApplyRequest = Omit<
  z.infer<typeof capabilityRulesApplySchema>,
  'changes'
> & { changes: readonly CapabilityRuleChange[] }

/**
 * A scope's OWN permission rules — what it stores, not the composed answer a run evaluates.
 *
 * Editing is always about one scope's own list: the effective set is the maximum over the
 * chain, and a screen that let you edit that composition could not say which scope a change
 * belonged to.
 */
export const capabilityPermissionsQuerySchema = capabilityScopeSchema

export const capabilityRulesSchema = z.object({
  /** The stored scope these rules belong to: `global`, `project:<id>` or `agent:<handle>`. */
  scope: z.string(),
  revision: z.number().int().nonnegative(),
  rules: z.array(capabilityRuleSchema),
  /**
   * The rules this scope ships with, present only for a role the product owns. It is what
   * the editor's Reset writes, and comparing it with `rules` is how the editor knows whether
   * there is anything to reset. Absent means the scope has no default — every scope a user
   * or an extension owns.
   */
  defaults: z.array(capabilityRuleSchema).optional(),
  registration: z
    .strictObject({
      agentId: z.string(),
      projectId: z.string(),
      sourceName: z.string(),
      revision: z.number().int().nonnegative(),
      proposedRules: z.array(capabilityRuleSchema),
    })
    .optional(),
})
export type CapabilityRules = z.infer<typeof capabilityRulesSchema>

export const updateCapabilityRulesSchema = capabilityScopeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  rules: z.array(capabilityRuleSchema).max(500),
})
