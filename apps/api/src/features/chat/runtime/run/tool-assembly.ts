/**
 * Per-run tool assembly: gathers MCP tools onto the built-in registry tools, wraps every tool with
 * mini app tool-call hooks and the repeat-failure guard, and populates the shared background-tool
 * name set. Driven by the tools stage (`stages/tools.ts`).
 */
import type { AgentTool, ToolSurface } from '@localixai/agent/agents'

import { approvedInputFor, type CcHooksRuntime } from '../../../cc-hooks'
import type { RunProfile } from '../../../agent-core/run-shape'
import { isDeferredCoreTool } from '../../../agent-core/tool-names'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { SessionRecord } from '../../repository'
import { applyToolWrapperChain } from './tool-wrapper-chain'
import { createChainGate, type ChainGate } from './chain-gate'
import type { ModRunScope } from '../../../mods/run-scope'
import { consoleWarnLogger } from '../plugin-hook-logger'
import type { McpInventoryEntry } from './mcp-tools'
import { gatherRunMcpTools } from './tool-assembly-mcp'
import { createActivateToolsTool } from '../../../agent-core/tools/activate-tools/activate-tools'
import type { AvailabilityReader } from '../../../capabilities/availability'
import type { ResolvedCapabilities } from '../../../capabilities/resolve'
import { claimSecondaryTools } from './tool-namespace'
import { rememberActivatedTools, splitDeferredTools } from './tool-deferral'
import { markDeferred, type ToolLedger } from '../../../agent-core/tool-ledger'
import type { AgentMcpServers } from '../../../mcp/agent-servers'
import { withheldToolStubs } from '../../../agent-core/tools/withheld-stub'
import type { buildRunToolRegistry } from './runtime-tools'
import type { RunEnv } from './types'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'

/** The catalog label of a built-in behind `ToolSearch`. */
const BUILTIN_SOURCE = 'Localix'

export interface AssembleRunToolsOptions {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentProfile: RunProfile
  runtimeTools: ReturnType<typeof buildRunToolRegistry>
  loadedPlugins: LoadedPlugins
  loadedMiniApps: LoadedMiniApps
  /** Per-run CC declarative-hook runtime (PreToolUse/PostToolUse tool wrapping). */
  ccHooks: CcHooksRuntime
  /** Claude Code mods: `tool.call` around every tool, and the tools they registered. */
  mods?: ModRunScope
  defaultCwd: string
  disabledTools: string[]
  /** What the run's rules say about its MCP servers. */
  availability: AvailabilityReader
  /** The servers of the agent file this delegated run is (`agent-run-mcp.ts`). */
  agentServers?: AgentMcpServers
  /** Told how to disconnect the servers only this run reached, once it has connected them. */
  registerMcpRelease?: (release: () => Promise<void>) => void
  agentId?: string // whose rules `availability` holds: the MCP gather scope (`mcp-tools.ts`)
  capabilities: ResolvedCapabilities
  modelInput?: readonly string[]
  toolSurface?: ToolSurface
  /** Tools the turn's open mini app views and mini app wakes bring (`surface-tools.ts`). */
  surfaceTools?: readonly string[]
  /** Shared set populated in place from each tool's declared `background` flag. */
  backgroundToolNames: Set<string>
  /**
   * Tools a bare deny in Claude Code's settings takes out of the model's view (`WebFetch`,
   * `mcp__github`): off the wire and out of `ToolSearch`'s catalog, as Claude Code removes them.
   * They stay dispatchable, so a call that names one hears the gate's refusal. A promise: the
   * settings load while the MCP servers are gathered.
   */
  hiddenBySettings?: Promise<(tool: AgentTool) => boolean>
  /**
   * Filled from the declared `mutates` flag (no hardcoded names). Dispatching one forces a
   * durable write, so a crash mid-call leaves evidence — see `handleToolExecutionStart`.
   */
  mutatingToolNames?: Set<string>
}

export interface AssembledRunTools {
  /**
   * Model-visible tools: the core toolkit plus `ToolSearch` when anything is deferred.
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
  /** Where the run's calls meet the permission gate; intake binds the gate to it. */
  gate: ChainGate
  /** On-wire tool names, in wire order. */
  wireToolNames: string[]
  /** Per-server MCP capability instructions to surface in the prompt (CC parity). */
  mcpInstructions: Array<{ server: string; text: string }>
  /** Direct/connecting MCP inventory surfaced in the volatile prompt tail. */
  mcpInventory: McpInventoryEntry[]
}

/** The tools whose start is stored at once (`handleToolExecutionStart`): every declared writer. */
export function recordMutatingTools(tools: readonly AgentTool[], into: Set<string>): void {
  for (const t of tools) if (t.mutates) into.add(t.name)
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
    loadedMiniApps,
    ccHooks,
    surfaceTools,
    backgroundToolNames,
    mutatingToolNames,
  } = options

  const allTools = [...runtimeTools.tools]
  const { mcp, external, acceptedMcp, mcpInstructions, mcpInventory } = await gatherRunMcpTools(
    options,
    allTools,
  )
  // ---- Mods' tools (`$.tool.register`) — an open toolset only, like MCP ----------------
  const modTools = agentProfile.openToolset ? (options.mods?.tools() ?? []) : []
  const claimedMods = claimSecondaryTools(allTools, modTools)
  allTools.push(...claimedMods.tools)
  // ---------------------------------------------------------------------

  // Every wrapper, in the order tool-wrapper-chain.ts declares — mini app hooks and CC hooks
  // innermost, then the timeout promoter, then the three no-progress guards. The order and
  // its reasons live with the list, so the composition dump and the code cannot disagree.
  // Inside the chain while a mod hears `tool.call` or `tool.check`, or a Claude Code hook hears
  // PreToolUse (`chain-gate.ts`): Claude Code runs PreToolUse before it asks anyone, so hookify's
  // warning or refusal comes ahead of the permission card.
  const gateInChain =
    (options.mods?.gateInChain ?? false) || (ccHooks.active && ccHooks.hasHooks('PreToolUse'))
  const gate = createChainGate(gateInChain, {
    approvedInput: (tool, toolCallId) =>
      approvedInputFor(ccHooks, tool, toolCallId, consoleWarnLogger),
  })
  const chained = applyToolWrapperChain(allTools, {
    gate,
    observe: env.deps?.externalAgents?.observe,
    sessionId: session.id,
    miniAppHooks: loadedMiniApps.hooks,
    miniAppHookOptions: { sessionId: session.id, logger: consoleWarnLogger },
    ccHooks,
    logger: consoleWarnLogger,
    mods: options.mods,
  })

  // Populate the shared background-tool set from the assembled tools' declared
  // `background` flag (generic — no hardcoded tool names). Done before any tool
  // executes, so the child-session + async-registry managers classify correctly.
  for (const t of allTools) if (t.background) backgroundToolNames.add(t.name)
  if (mutatingToolNames) recordMutatingTools(allTools, mutatingToolNames)

  // ---- Deferral: mini app, MCP and mod tools, and the few built-ins marked `deferred` ----------
  //
  // Mini app and MCP call catalogues can grow without bound. Core tools are a bounded product
  // contract and stay visible, except the few a run seldom calls (`Configure`, `Vault`,
  // `ExternalAgentSessions`): like Claude Code, an open toolset lists them in `ToolSearch`'s catalog.
  // Their schemas cost every request; loading one costs a turn only in the run that needs it, and
  // a call by name reaches it without loading, because the loop dispatches from `dispatchTools`.
  //
  // Deferred does NOT mean unavailable. Every implementation remains in `dispatchTools`;
  // `ToolSearch` tells the runtime which full schemas to append for the next model turn.
  // Wrapping happens BEFORE this split, so a deferred tool keeps its mini app hooks, its CC
  // hooks and its failure guard — deferral is a wire decision and nothing else.
  const sourceByTool = new Map<string, string>()
  // A closed list NAMED its MCP tools: they ride the wire like its built-ins, no activator.
  for (const [name, server] of Object.entries(mcp.gather?.serverByTool ?? {}))
    if (agentProfile.openToolset && acceptedMcp.has(name)) sourceByTool.set(name, server)
  for (const tool of loadedMiniApps.tools)
    if (!sourceByTool.has(tool.name)) sourceByTool.set(tool.name, 'mini-apps')
  for (const tool of claimedMods.tools)
    if (!sourceByTool.has(tool.name)) sourceByTool.set(tool.name, 'plugins')
  // Where a deferred tool is catalogued from: its provenance, or `Localix` for a deferred built-in.
  // Kept apart from `sourceByTool`, whose absent name means a core tool to every reader.
  const deferralSource = new Map(sourceByTool)
  // A role that names the tool in its `tools` list asked for it: it stays on the wire.
  const declared = new Set(agentProfile.declaredTools ?? [])
  if (agentProfile.openToolset)
    for (const tool of allTools)
      if (
        !deferralSource.has(tool.name) &&
        !declared.has(tool.name) &&
        isDeferredCoreTool(tool.name)
      )
        deferralSource.set(tool.name, BUILTIN_SOURCE)
  const activatedForSession = session.activatedTools ?? []
  // Claude Code mods' `tool.describe`: a description rewritten, a tool moved behind the
  // activator (`isDeferred: true`) or onto the wire (`false`).
  const onSurface = surfaceTools ?? []
  const described = await (options.mods?.describeTools(chained, {
    sources: sourceByTool,
    deferred: (name) =>
      deferralSource.has(name) && !activatedForSession.includes(name) && !onSurface.includes(name),
  }) ?? { tools: chained, placed: new Map<string, boolean>() })
  const wrapped = described.tools
  const placed = [...described.placed]
  for (const [name] of placed.filter(([, deferred]) => deferred)) {
    sourceByTool.set(name, sourceByTool.get(name) ?? 'mods')
    deferralSource.set(name, deferralSource.get(name) ?? 'mods')
  }
  const hidden = options.hiddenBySettings ? await options.hiddenBySettings : undefined
  const offered = hidden ? wrapped.filter((tool) => !hidden(tool)) : wrapped
  const split = splitDeferredTools(offered, deferralSource, activatedForSession, [
    ...onSurface,
    ...placed.filter(([, deferred]) => !deferred).map(([name]) => name),
  ])

  // The activator lives as long as this run has ANY external tool, even when the session has already
  // activated every one of them. Two reasons, both learned rather than assumed: a tool that vanishes from
  // the list mid-session is a list change that buys nothing, and the loader stays
  // active for the whole session because the stable prefix is what keeps the prompt cache warm. With an empty catalog it simply says so.
  const activator =
    split.externalEntries.length > 0
      ? createActivateToolsTool({
          entries: split.externalEntries,
          sessionActive: split.active,
          onActivated: (names) => rememberActivatedTools(env, userId, session, names),
        })
      : undefined
  // The activator sits between the core tools and the activated ones, so an activation appends: the
  // list a run sends after revealing a tool (the roster appends it) is the list the next run starts
  // with, and the provider's cache keeps the prefix that run built instead of rewriting it.
  const tools = activator
    ? [...split.direct, activator, ...split.promoted]
    : [...split.direct, ...split.promoted]
  // Withheld built-ins get a DISPATCH-ONLY stub (never a model schema): a model that names
  // one anyway is told why it is missing and what would bring it back, instead of the loop's
  // bare "Tool X not found". `validateToolRegistry` admits `modelTools ⊂ dispatchTools`.
  const combinedLedger = new Map(runtimeTools.ledger)
  const primaryNames = new Set(runtimeTools.tools.map((tool) => tool.name))
  for (const [name, verdict] of external.ledger)
    // A dynamic provider may supply an empty optional core port (MCP resources), but may
    // never replace a descriptor already built by the primary registry.
    if (!primaryNames.has(name)) combinedLedger.set(name, verdict)
  const deferredSources = new Map(
    split.deferredEntries.map((entry) => [entry.tool.name, entry.source]),
  )
  const ledger = markDeferred(combinedLedger, deferredSources)
  runtimeTools.setLedger?.(ledger)
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
    gate,
    /** On-wire tool names, in wire order. */
    wireToolNames: tools.map((tool) => tool.name),
  }
}
