import { z } from 'zod'
import { agentSummarySchema } from '../features/agents/contracts'
import { composerTipSchema } from '../features/capabilities/tip-contracts'
import { skillSummarySchema } from '../features/chat/contracts/skills'
import { toolSurfaceSchema } from '../features/effective-config/contracts'
import { mcpServerSchema } from '../features/mcp/contracts'
import { miniAppCommandSpecSchema, miniAppRecordSchema } from '../features/mini-apps/contracts'
import { miniAppViewSpecSchema } from '../features/mini-apps/contracts-contributions'
import { pluginCommandSpecSchema, pluginRecordSchema } from '../features/plugins/contracts'
import { pluginThemeSpecSchema } from '../features/plugins/contracts-themes'
import { toolMetaSchema } from '../features/tools/catalog'

/**
 * Wire contract for `GET /rpc/capabilities/snapshot` — ONE versioned answer to
 * "what can this scope do right now", composed by ONE resolver (`features/capabilities/snapshot.ts`).
 *
 * Every field here used to be its own endpoint, and the clients that needed two of
 * them fetched two and re-derived the shared fact ("is this plugin enabled") twice.
 * That is how disabling a plugin could update the plugin list while leaving its tools
 * listed as enabled and its views mounted: two projections, two refresh keys, one of
 * them not advancing. Fields are composed from their owning features' schemas — never
 * restated — so a snapshot cannot describe a plugin/agent/MCP record differently from
 * the endpoint that manages it.
 *
 * It lives outside the features because it is composed FROM several of them: kept in
 * `capabilities`, it made that feature import every feature that already depends on it.
 */

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
   * builtin + mini app toggles through `disabledTools`; MCP owns its own per-server tool filters.
   * Merging the two lists would put a row in the Tools tab whose switch does not live there.
   *
   * It exists because a count taken from `enabled.length` alone is WRONG by exactly this many:
   * MCP tools are gathered per run, so the surface the model receives is builtins + mini app tools +
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
  /** Installed Claude Code plugins, including disabled ones. */
  plugins: z.array(pluginRecordSchema),
  /** Installed mini apps, including disabled ones and ones waiting for the person's yes. */
  miniApps: z.array(miniAppRecordSchema),
  tools: capabilityToolSurfaceSchema,
  /** Sandboxed UI views of enabled mini apps — each opens as a work-item tab. */
  views: z.array(miniAppViewSpecSchema),
  /** Color themes of enabled global plugins, offered in Settings → Preferences → Appearance. */
  themes: z.array(pluginThemeSpecSchema),
  /** Managed sub-agents visible to the scope, with their enable state. */
  agents: z.array(agentSummarySchema),
  /** Slash commands declared by enabled plugins, flattened + namespaced. */
  commands: z.array(pluginCommandSpecSchema),
  /** Commands declared in enabled mini apps' `mini-app.json`, run as `/<app>:<command>`. */
  miniAppCommands: z.array(miniAppCommandSpecSchema),
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
