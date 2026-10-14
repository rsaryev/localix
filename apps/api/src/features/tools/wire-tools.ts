import { TOOL } from '../agent-core/tool-names'

/**
 * Which surfaced tool names a run will NOT actually carry.
 *
 * `computeToolSurface` resolves the settings/mode DENY policy, and its own doc says host-dependent
 * assembly is "intentionally not guessed here" — correctly, because that assembly belongs to the
 * registry. The consequence is that `enabled` legitimately lists names no run receives, and any
 * consumer displaying a COUNT has to subtract them or it reports a number the model never sees.
 *
 * That subtraction lives here, once, because there are two such consumers — the composer's budget
 * pill and the Tools settings screen — and they disagreed by 1 and by 4 on the live database while
 * BOTH documented themselves as "what the next run receives". A second copy of this rule is a rule
 * that will drift; this is the same reasoning that put `hysteresis` on the wire instead of in the
 * component.
 *
 * Not a policy and not a denial: these names are real, toggleable tools that are simply absent from
 * this particular run's assembly. They still belong in a list of switches — only not in a count of
 * what goes on the wire.
 */
export interface WireToolFacts {
  /** `computeToolSurface`'s enabled projection. */
  enabled: readonly string[]
  /** Probed MCP servers. Only the presence of any is consulted. */
  mcp: readonly unknown[]
  /** Enabled MCP servers whose tools could not be read from the connection cache. */
  mcpUnprobedServers: readonly string[]
}

/**
 * The consolidated MCP-resource tool. Builtin name, but `buildMcpResourceTools` opens with
 * `if (args.resourceServers.length === 0) return []`, and `resourceServers` collects only servers
 * whose connected client reports `getServerCapabilities().resources`.
 */
const MCP_RESOURCE_TOOLS: readonly string[] = [TOOL.mcp_resources]

export function phantomToolNames(facts: WireToolFacts): ReadonlySet<string> {
  const phantom = new Set<string>()

  // The weakest test that is still CERTAIN: no probed and no unprobed server means this scope has
  // no enabled MCP server at all, so nothing can advertise `resources`. A connected server exposing
  // no tools cannot hide from it — `cachedToolNames` pushes it into `mcp` with an empty `tools`
  // array rather than dropping it.
  //
  // Deliberately does not guess when servers DO exist: whether one advertises `resources` lives in
  // the connection cache, which no snapshot carries. That over-count stays visible through
  // `mcpUnprobedServers` instead of being silently assumed away.
  if (facts.mcp.length === 0 && facts.mcpUnprobedServers.length === 0) {
    for (const name of MCP_RESOURCE_TOOLS) {
      if (facts.enabled.includes(name)) phantom.add(name)
    }
  }

  return phantom
}
