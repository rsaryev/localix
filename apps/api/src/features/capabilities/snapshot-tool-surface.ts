import { computeToolSurface } from '../effective-config/validate'
import type { ToolSurfaceDenial } from '../effective-config/contracts'
import {
  CATEGORY_LABELS,
  toolCatalogEntries,
  type ToolCatalogMiniAppSource,
} from '../tools/catalog'
import type { CapabilityToolSurface } from '../../contracts/capability-snapshot'

/**
 * Project the tool catalog of one scope through the deny policy the run pipeline
 * consumes, keeping the tools it removed and WHY.
 *
 * Pure, and the reason this is not inlined below: it is the rule the "disabling a
 * plugin removes its tools" behaviour rests on, so it is unit-testable without a DB,
 * a filesystem, or a session.
 *
 * Deliberately NOT modelled here: descriptor-level `availability.requiredCapabilities`
 * (an unavailable preview host, a missing orchestration capability). Those are
 * per-RUN host facts that `computeToolSurface` has always refused to guess — see its
 * comment — and guessing them from a settings request would produce a second, weaker
 * copy of a rule the tool registry already owns.
 */
export function buildCapabilityToolSurface(input: {
  miniApps: readonly ToolCatalogMiniAppSource[]
  disabledTools: string[]
  mcp?: {
    servers: Array<{ serverId: string; serverName: string; tools: string[] }>
    unprobed: string[]
  }
}): CapabilityToolSurface {
  const entries = toolCatalogEntries(input.miniApps)
  const structuralDenials: ToolSurfaceDenial[] = entries.flatMap((entry) =>
    entry.unavailableReason
      ? [{ name: entry.meta.name, reason: entry.unavailableReason, source: 'capability' as const }]
      : [],
  )
  const surface = computeToolSurface({
    disabledTools: input.disabledTools,
    // The FULL catalog, not just the dispatchable subset: a name that never reaches
    // `computeToolSurface` can appear in neither `enabled` nor `disabled`, and a tool
    // that silently vanishes is the symptom this endpoint exists to end.
    toolNames: entries.map(({ meta }) => meta.name),
    structuralDenials,
  })
  return {
    ...surface,
    catalog: entries.map(({ meta }) => meta),
    categoryLabels: CATEGORY_LABELS,
    // MCP rides alongside rather than through `computeToolSurface`: that function resolves the
    // settings deny-policy over names the Tools tab can toggle, and an MCP tool is switched off
    // somewhere else entirely. Passing it through would render a row whose switch is not there.
    mcp: input.mcp?.servers ?? [],
    // ONE list, because the consumer's question is the same whatever the reason: "what is missing
    // from this number". The caller decides what goes in — this function stays descriptor-free.
    mcpUnprobedServers: input.mcp?.unprobed ?? [],
  }
}
