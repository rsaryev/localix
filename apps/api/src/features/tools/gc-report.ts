import {
  resolveToolGc,
  TOOL_BUDGET_HOT_MARGIN,
  TOOL_BUDGET_HYSTERESIS,
  TOOL_BUDGET_WARN_DEFAULT,
  type ToolGcEvidence,
  type ToolGcSuggestion,
  type ToolGcSurfaced,
} from '../agent-core/tool-gc'
import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import type { ToolUsageRecord } from './usage-repository'
import { phantomToolNames } from './wire-tools'

/**
 * Composes the tool-GC report: the capability snapshot says what is SURFACED, the usage table says
 * what has been USED, and `resolveToolGc` decides. Nothing here holds a rule of its own — the only
 * job is joining two sources that must not be joined twice differently.
 *
 * Deliberately NOT folded into the capability snapshot itself. That document is cached per
 * `capabilityRevision()`, and usage changes on every tool call without bumping it, so the GC half
 * would go stale behind a revision claiming to be current — a worse failure than a second request,
 * because it is invisible.
 */

export interface ToolCounts {
  builtin: number
  miniApp: number
  mcp: number
  /** What a run actually puts on the wire, and the only number a UI may display. */
  total: number
  /** Amber at or above this. */
  warn: number
  /** Hot at or above this. */
  hot: number
  /**
   * How far the count must fall BELOW `warn` before amber clears.
   *
   * On the wire rather than duplicated client-side: the pill owns the one bit of state
   * (was-it-amber) that makes hysteresis possible, so it needs the width, and a second copy of the
   * constant in the UI is a constant that will drift.
   */
  hysteresis: number
}

export interface ToolGcReport {
  evidence: ToolGcEvidence
  suggestions: ToolGcSuggestion[]
  counts: ToolCounts
  /**
   * Where `total` came from. `estimate` means the MCP half was read from the connection cache
   * before this scope's first run — see `mcpUnprobed`, which names what it could not see.
   */
  source: 'estimate'
  /** Enabled MCP servers whose tool count is unknown. Named, never silently dropped. */
  mcpUnprobed: string[]
  /**
   * Tool names ALREADY off in this scope because settings say so — i.e. the scope's current
   * `disabledTools`, projected out of the same snapshot.
   *
   * On the wire because the write endpoint REPLACES the whole array, and the report only ever
   * lists SURFACED tools. A client that applied a suggestion by writing just the picked names
   * would erase every earlier toggle. Only `source: 'settings'` denials qualify: an
   * unavailable host is not an entry in that array and writing it into it would make a
   * transient gate permanent.
   */
  disabledNames: string[]
}

/**
 * Flatten a snapshot into the (name, source, originId) triples the rule set judges.
 *
 * `enabled` is authoritative for the builtin+mini app half: it is `computeToolSurface`'s output, so
 * a tool switched off in settings is already gone. Attribution comes from `catalog`, which is
 * the same projection's metadata — never a second
 * lookup that could disagree about which plugin owns a name.
 */
export function surfacedFromSnapshot(snapshot: CapabilitySnapshot): ToolGcSurfaced[] {
  const metaByName = new Map(snapshot.tools.catalog.map((meta) => [meta.name, meta]))
  // The one rule, shared with the Tools settings screen so the two visible counts cannot drift.
  const phantom = phantomToolNames(snapshot.tools)
  const surfaced: ToolGcSurfaced[] = snapshot.tools.enabled
    .filter((name) => !phantom.has(name))
    .map((name) => {
      const provider = metaByName.get(name)?.provider
      return provider
        ? { name, source: 'mini-app' as const, originId: provider.id }
        : { name, source: 'builtin' as const, originId: '' }
    })
  for (const server of snapshot.tools.mcp) {
    for (const name of server.tools) {
      surfaced.push({ name, source: 'mcp', originId: server.serverId })
    }
  }
  return surfaced
}

export function buildToolGcReport(input: {
  snapshot: CapabilitySnapshot
  usage: readonly ToolUsageRecord[]
  /** Resolved `toolBudgetWarn`; absent/invalid falls back to the default. */
  warn?: number | null
  now: string
}): ToolGcReport {
  const surfaced = surfacedFromSnapshot(input.snapshot)
  const { evidence, suggestions } = resolveToolGc({
    surfaced,
    usage: input.usage.map((row) => ({
      name: row.toolName,
      calls: row.calls,
      errors: row.errors,
      firstSeenAt: row.firstSeenAt,
      lastUsedAt: row.lastUsedAt,
    })),
    now: input.now,
  })

  const warn = input.warn && input.warn > 0 ? Math.floor(input.warn) : TOOL_BUDGET_WARN_DEFAULT
  const counts: ToolCounts = {
    builtin: surfaced.filter((tool) => tool.source === 'builtin').length,
    miniApp: surfaced.filter((tool) => tool.source === 'mini-app').length,
    mcp: surfaced.filter((tool) => tool.source === 'mcp').length,
    // Summed from the SAME list the suggestions were judged against. Counting the three groups
    // independently is how a displayed total drifts from what was sent.
    total: surfaced.length,
    warn,
    hot: warn + TOOL_BUDGET_HOT_MARGIN,
    hysteresis: TOOL_BUDGET_HYSTERESIS,
  }

  return {
    evidence,
    suggestions,
    counts,
    source: 'estimate',
    mcpUnprobed: input.snapshot.tools.mcpUnprobedServers,
    disabledNames: input.snapshot.tools.disabled
      .filter((denial) => denial.source === 'settings')
      .map((denial) => denial.name),
  }
}
