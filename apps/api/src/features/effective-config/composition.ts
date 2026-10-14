import { TOOL_WRAPPER_CHAIN } from '../chat/runtime/run/tool-wrapper-chain'
import type { AssembledRunTools } from '../chat/runtime/run/tool-assembly'
import type { LoadedPlugins } from '../plugins/loader'

/**
 * "What is actually loaded right now, and who contributed it?"
 *
 * The question a person asks when the model cannot see a tool they just installed, and the
 * one that used to take reading four subsystems to answer: the plugin loader knows what it
 * enabled, the tool assembly knows what survived gating, the MCP manager knows which server
 * a name came from, and nothing put the three together.
 *
 * The report is built from values the ROSTER ITSELF produced — `sourceByTool` and
 * `wireToolNames` come back from `assembleRunTools`, and the wrapper order is the exported
 * `TOOL_WRAPPER_CHAIN` the assembly applies. That is the whole design constraint: a dump
 * assembled from a parallel description would drift from the real thing, and a drifting
 * answer to this question is worse than no answer, because it is believed.
 */

/** Where a tool came from. `core` is the absence of any other provenance, not a label. */
export type ToolOrigin =
  | { kind: 'core' }
  | { kind: 'plugin' }
  | { kind: 'mcp'; server: string }
  | { kind: 'mcp-resources' }

export interface ToolCompositionEntry {
  name: string
  origin: ToolOrigin
  /**
   * `wire` — the model sees its schema this turn. `deferred` — it exists and is callable,
   * but its schema is behind `activate_tools`. The distinction matters because "the model
   * cannot see it" and "it is not loaded" are different problems with different fixes.
   */
  visibility: 'wire' | 'deferred'
}

export interface PluginCompositionEntry {
  name: string
  scope: 'global' | 'project'
  /** What it contributed, by name — a plugin that loaded and contributed nothing shows empty. */
  contributes: { tools: string[]; skills: string[]; mcpServers: string[] }
  /**
   * Why it contributed nothing, when that is the answer. A plugin that failed to load is the
   * single most likely cause of "the model cannot see my tool", so it is reported rather than
   * silently listed as empty.
   */
  error?: string
}

export interface CompositionReport {
  plugins: PluginCompositionEntry[]
  tools: ToolCompositionEntry[]
  /** Wrapper order, innermost-first, as applied — read from the assembly, not restated. */
  wrappers: readonly string[]
  mcp: { server: string; tools: number }[]
}

/** Classify one tool from the provenance the split recorded. */
function originOf(name: string, sourceByTool: ReadonlyMap<string, string>): ToolOrigin {
  const source = sourceByTool.get(name)
  if (source === undefined) return { kind: 'core' }
  if (source === 'plugins') return { kind: 'plugin' }
  if (source === 'mcp-resources') return { kind: 'mcp-resources' }
  return { kind: 'mcp', server: source }
}

/**
 * Assemble the report. Pure: every input is a value some subsystem already computed, so this
 * cannot disagree with them — it can only fail to be regenerated, which the caller controls.
 */
export function describeComposition(input: {
  assembled: Pick<
    AssembledRunTools,
    'wireToolNames' | 'deferredToolNames' | 'sourceByTool' | 'mcpInventory'
  >
  loadedPlugins: Pick<LoadedPlugins, 'loaded'>
}): CompositionReport {
  const { assembled, loadedPlugins } = input

  const tools: ToolCompositionEntry[] = [
    ...assembled.wireToolNames.map((name) => ({
      name,
      origin: originOf(name, assembled.sourceByTool),
      visibility: 'wire' as const,
    })),
    ...assembled.deferredToolNames.map((name) => ({
      name,
      origin: originOf(name, assembled.sourceByTool),
      visibility: 'deferred' as const,
    })),
  ]

  return {
    // `loaded` is the loader's OWN per-plugin summary — the same one the prompt's plugin
    // section reads. Recounting contributions from the flat arrays would be a second
    // opinion about what the loader already decided, including which plugin owns what.
    plugins: loadedPlugins.loaded.map((plugin) => ({
      name: plugin.name,
      scope: plugin.scope,
      contributes: {
        tools: plugin.toolNames,
        skills: plugin.skills,
        mcpServers: plugin.mcpServers,
      },
      ...(plugin.error ? { error: plugin.error } : {}),
    })),
    tools,
    wrappers: TOOL_WRAPPER_CHAIN.map((entry) => entry.label),
    mcp: Object.entries(assembled.mcpInventory ?? {}).map(([server, entry]) => ({
      server,
      tools: Array.isArray(entry) ? entry.length : 0,
    })),
  }
}
