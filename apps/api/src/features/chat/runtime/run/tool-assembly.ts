/**
 * Per-run tool assembly: gathers MCP tools onto
 * the built-in registry tools, wraps every tool with plugin tool-call hooks and
 * the repeat-failure guard, and populates the shared background-tool name set.
 * Driven by the tools stage (`stages/tools.ts`).
 */
import type { AgentTool, ToolSurface } from '@localixai/agent/agents'

import type { CcHooksRuntime } from '../../../cc-hooks'
import type { RunProfile } from '../../../agent-core/run-shape'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { SessionRecord } from '../../repository'
import { applyToolWrapperChain } from './tool-wrapper-chain'
import { consoleWarnLogger } from '../plugin-hook-logger'
import { resolveMcpTools, type McpInventoryEntry } from './mcp-tools'
import { createActivateToolsTool } from '../../../agent-core/tools/activate-tools/activate-tools'
import type { AvailabilityReader } from '../../../capabilities/availability'
import { rememberActivatedTools, splitDeferredTools } from './tool-deferral'
import { markDeferred, type ToolLedger } from '../../../agent-core/tool-ledger'
import { withheldToolStubs } from '../../../agent-core/tools/withheld-stub'
import type { buildRunToolRegistry } from './runtime-tools'
import type { RunEnv } from './types'

export interface AssembleRunToolsOptions {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentProfile: RunProfile
  runtimeTools: ReturnType<typeof buildRunToolRegistry>
  loadedPlugins: LoadedPlugins
  /** Per-run CC declarative-hook runtime (PreToolUse/PostToolUse tool wrapping). */
  ccHooks: CcHooksRuntime
  defaultCwd: string
  disabledTools: string[]
  /** What the run's rules say about its MCP servers. */
  availability: AvailabilityReader
  toolSurface?: ToolSurface
  /** Tools the turn's open plugin views and plugin wakes bring (`surface-tools.ts`). */
  surfaceTools?: readonly string[]
  /** Shared set populated in place from each tool's declared `background` flag. */
  backgroundToolNames: Set<string>
  /**
   * Filled from the declared `mutates` flag (no hardcoded names). Dispatching one forces a
   * durable write, so a crash mid-call leaves evidence — see `handleToolExecutionStart`.
   */
  mutatingToolNames?: Set<string>
}

export interface AssembledRunTools {
  /**
   * Model-visible tools: the core toolkit plus `activate_tools` when anything is deferred.
   * A STRICT SUBSET of `dispatchTools` — that split is the whole deferral mechanism.
   */
  tools: AgentTool[]
  /**
   * Every dispatchable tool, including deferred implementations, the activator and diagnostic
   * stubs for withheld built-ins. The runtime appends an activated tool's full model schema
   * before its next model turn.
   */
  dispatchTools: AgentTool[]
  /** Real implementations, including deferred tools, before dispatch-only withheld stubs are added. */
  preflightTools: AgentTool[]
  /** Deferred tool names, for diagnostics and the prompt's tool roster. */
  deferredToolNames: string[]
  /** The registry's ledger with the economy layer applied: one verdict per tool this run knows. */
  ledger: ToolLedger
  /**
   * Where each tool came from, as the split decided it — an absent name is core. Exposed so
   * the composition dump reads what the roster was BUILT from, not a second opinion about it.
   */
  sourceByTool: ReadonlyMap<string, string>
  /** On-wire tool names, in wire order. */
  wireToolNames: string[]
  /** Per-server MCP capability instructions to surface in the prompt (CC parity). */
  mcpInstructions: Array<{ server: string; text: string }>
  /** Direct/connecting MCP inventory surfaced in the volatile prompt tail. */
  mcpInventory: McpInventoryEntry[]
}

export interface ClaimedToolSet {
  /** Secondary descriptors whose names were not already owned by primary. */
  tools: AgentTool[]
  /** Names rejected because primary (or an earlier secondary row) already owns them. */
  conflicts: string[]
}

/**
 * Descriptor-owned UI metadata for every tool the runtime may dispatch.
 *
 * This must be indexed from `dispatchTools`, not only the initially model-visible
 * `tools` projection: plugin/MCP tools can be revealed later by `activate_tools`,
 * but their presentation contract (`activeVerb`, `standalone`) is already part of
 * the canonical descriptor. Keeping the lookup generic lets any deferred tool own
 * an interactive surface without the chat runtime knowing its name.
 */
export function indexToolPresentation(
  tools: readonly AgentTool[],
): Map<string, Pick<AgentTool, 'activeVerb' | 'standalone' | 'presentation'>> {
  return new Map(
    tools.map((tool) => [
      tool.name,
      {
        activeVerb: tool.activeVerb,
        standalone: tool.standalone,
        presentation: tool.presentation,
      },
    ]),
  )
}

/**
 * Merge a later tool provider into the canonical runtime namespace.
 *
 * The provider/runtime boundary requires one descriptor per name. MCP tools are
 * discovered after the built-in/plugin registry, so they are the secondary
 * owner: a colliding MCP name must not reach either model or dispatch.
 */
export function claimSecondaryTools(
  primary: readonly AgentTool[],
  secondary: readonly AgentTool[],
): ClaimedToolSet {
  const claimed = new Set(primary.map((tool) => tool.name))
  const tools: AgentTool[] = []
  const conflicts = new Set<string>()

  for (const tool of secondary) {
    if (claimed.has(tool.name)) {
      conflicts.add(tool.name)
      continue
    }
    claimed.add(tool.name)
    tools.push(tool)
  }

  return {
    tools,
    conflicts: [...conflicts].sort(),
  }
}

export async function assembleRunTools(
  options: AssembleRunToolsOptions,
): Promise<AssembledRunTools> {
  const {
    env,
    userId,
    session,
    agentProfile,
    runtimeTools,
    loadedPlugins,
    ccHooks,
    defaultCwd,
    disabledTools,
    availability,
    toolSurface,
    surfaceTools,
    backgroundToolNames,
    mutatingToolNames,
  } = options

  const allTools = [...runtimeTools.tools]
  let mcpInstructions: Array<{ server: string; text: string }> = []
  let mcpInventory: McpInventoryEntry[] = []

  // ---- MCP tools (persistent clients) ----------------------------------
  // Resolve the user's enabled MCP servers to AgentTools via the process-
  // lifetime client manager: connects (and lists tools) only on first use
  // or after a config change / broken transport, then reuses the cached
  // client — keeping slow stdio spawns off the per-message critical path.
  // An optional server that's down degrades gracefully (its tools are absent);
  // `required:true` servers fail startup. Servers removed/disabled since the last
  // gather get their clients disposed by the manager. Disabled tools are
  // filtered by the registry's allow-list, mirroring built-in tools.
  // Only interactive/delegating profiles (chat/orchestrator, subagent) receive
  // MCP tools. The automation profile is a CLOSED allowlist (focused unattended
  // loop/job workers) — MCP tools would otherwise bypass its filter and bloat
  // every worker's tool payload with servers it never uses. Skipping the gather
  // also avoids the per-run MCP connect cost for workers.
  const mcp = agentProfile.openToolset
    ? await resolveMcpTools({
        env,
        userId,
        session,
        pluginMcpServers: loadedPlugins.mcpServers,
        defaultCwd,
        disabledTools,
        availability,
        toolSurface,
      })
    : {
        gather: undefined,
        tools: [],
        instructions: [],
        inventory: [],
      }
  const claimedMcp = claimSecondaryTools(allTools, mcp.tools)
  allTools.push(...claimedMcp.tools)
  if (claimedMcp.conflicts.length > 0) {
    console.warn(
      `[agent-runner] Ignoring MCP tools whose names are already owned by the runtime registry: ${claimedMcp.conflicts.join(', ')}`,
    )
  }
  mcpInstructions = mcp.instructions
  const acceptedMcpModelNames = new Set(claimedMcp.tools.map((tool) => tool.name))
  mcpInventory = mcp.inventory.flatMap((entry) => {
    if (entry.pending || entry.failed) return [entry]
    const tools = entry.tools.filter((name) => acceptedMcpModelNames.has(name))
    return tools.length > 0 ? [{ ...entry, tools }] : []
  })
  // ---------------------------------------------------------------------

  // Every wrapper, in the order tool-wrapper-chain.ts declares — plugin hooks and CC hooks
  // innermost, then the timeout promoter, then the three no-progress guards. The order and
  // its reasons live with the list, so the composition dump and the code cannot disagree.
  const wrapped = applyToolWrapperChain(allTools, {
    pluginHooks: loadedPlugins.hooks,
    pluginHookOptions: { sessionId: session.id, logger: consoleWarnLogger },
    ccHooks,
    logger: consoleWarnLogger,
  })

  // Populate the shared background-tool set from the assembled tools' declared
  // `background` flag (generic — no hardcoded tool names). Done before any tool
  // executes, so the child-session + async-registry managers classify correctly.
  for (const t of allTools) if (t.background) backgroundToolNames.add(t.name)
  if (mutatingToolNames) for (const t of allTools) if (t.mutates) mutatingToolNames.add(t.name)

  // ---- Deferral: only external plugin and MCP call tools go behind `activate_tools` -------
  //
  // Plugin and MCP call catalogues can grow without bound. Core tools are a bounded product
  // contract and always stay visible, so an agent never spends a turn loading a capability the
  // application itself owns.
  //
  // Deferred does NOT mean unavailable. Every implementation remains in `dispatchTools`;
  // `activate_tools` tells the runtime which full schemas to append for the next model turn.
  // Wrapping happens BEFORE this split, so a deferred tool keeps its plugin hooks, its CC
  // hooks and its failure guard — deferral is a wire decision and nothing else.
  const sourceByTool = new Map<string, string>()
  for (const [name, server] of Object.entries(mcp.gather?.serverByTool ?? {}))
    sourceByTool.set(name, server)
  for (const tool of loadedPlugins.tools)
    if (!sourceByTool.has(tool.name)) sourceByTool.set(tool.name, 'plugins')
  const activatedForSession = session.activatedTools ?? []
  const split = splitDeferredTools(wrapped, sourceByTool, activatedForSession, surfaceTools)

  // The activator lives as long as this run has ANY external tool, even when the session has already
  // activated every one of them. Two reasons, both learned rather than assumed: a tool that vanishes from
  // the list mid-session is a list change that buys nothing, and pi's deferred-loading guidance is to keep
  // the loader active for the whole session because the stable prefix is what keeps the prompt cache warm
  // (`packages/coding-agent/docs/extensions.md`). With an empty catalog it simply says so.
  const activator =
    split.externalEntries.length > 0
      ? createActivateToolsTool({
          entries: split.externalEntries,
          sessionActive: split.active,
          onActivated: (names) => rememberActivatedTools(env, userId, session, names),
        })
      : undefined
  const onWire = [...split.direct, ...split.promoted]
  const tools = activator ? [...onWire, activator] : onWire
  // Withheld built-ins get a DISPATCH-ONLY stub (never a model schema): a model that names
  // one anyway is told why it is missing and what would bring it back, instead of the loop's
  // bare "Tool X not found". `validateToolRegistry` admits `modelTools ⊂ dispatchTools`.
  const ledger = markDeferred(runtimeTools.ledger, sourceByTool)
  const stubs = withheldToolStubs(ledger, new Set(wrapped.map((tool) => tool.name)))
  const preflightTools = [...wrapped, ...(activator ? [activator] : [])]
  const dispatchTools = [...wrapped, ...stubs, ...(activator ? [activator] : [])]

  return {
    tools,
    dispatchTools,
    preflightTools,
    ledger,
    deferredToolNames: split.deferredEntries.map((entry) => entry.tool.name),
    mcpInstructions,
    mcpInventory,
    /**
     * Where each tool came from, as the split itself decided it — a name absent from the map
     * is core. Returned rather than recomputed by consumers: the composition dump has to
     * answer "who contributed this" with the value the roster was actually built from, or it
     * would be a second opinion about the same question.
     */
    sourceByTool: sourceByTool as ReadonlyMap<string, string>,
    /** On-wire tool names, in wire order. */
    wireToolNames: tools.map((tool) => tool.name),
  }
}
