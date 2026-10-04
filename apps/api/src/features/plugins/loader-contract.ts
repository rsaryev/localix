import type { AgentTool } from '@localixai/agent/agents'

import type { PluginHookConfig } from '../cc-hooks'
import type { McpServerRecord } from '../mcp/repository'
import type { DiscoveredSkill } from '../agent-core/skill-discovery'
import type { BackendSubsystem } from '../ext/subsystem-contrib'
import { normalizeCcToolName } from './discovery'
import type { MemoryProvider, PluginChannel, PluginContext, PluginHooks } from './native'
import type { PluginAgent, PluginMonitor } from './contracts'

/**
 * WHAT A LOAD PRODUCES — the shape every consumer of `loadEnabledPlugins` reads.
 *
 * Split from the loader because the two change for different reasons: this is the contract
 * between a plugin's manifest and the runtime that consumes it, while `loader.ts` is the
 * orchestration that fills it in. A reader asking "what can a plugin contribute" should not
 * have to scroll past the import machinery to find out.
 */

/** A resolved plugin agent role, namespaced `<plugin>:<name>`, ready for delegated task dispatch. */
export interface LoadedPluginAgent {
  pluginName: string
  name: string
  /** Canonical assignee key: `<plugin>:<name>` */
  fullName: string
  label: string
  description: string
  /** Worker system prompt / identity. */
  prompt: string
  /** Engine tool names (undefined = the role's default tool surface). */
  tools?: string[]
  /** Engine tool names blocked for this role. */
  disallowedTools?: readonly string[]
  /** Advisory model hint from frontmatter `model:`. */
  preferredModel?: string
  /** CC `skills:` — skill names to preload when this agent runs. */
  pinnedSkills?: string[]
  /** CC `effort:` — advisory reasoning effort hint. */
  preferredEffort?: string
}

export interface LoadedPluginHook {
  pluginName: string
  hooks: PluginHooks
  ctx: PluginContext
}

/**
 * One background monitor contributed by an ENABLED plugin — its typed spec plus the
 * roots the monitor host exports to the command's env (`CLAUDE_PLUGIN_ROOT` /
 * `CLAUDE_PLUGIN_DATA`; never pasted into the shell text). Only enabled plugins contribute (the
 * enable state is the trust gate — monitors run unsandboxed at hook trust level).
 */
export interface LoadedPluginMonitor {
  pluginName: string
  pluginRoot: string
  dataDir: string
  monitor: PluginMonitor
}

export interface LoadedPlugins {
  /** Native AgentTools to inject via the registry's `extraTools`. */
  tools: AgentTool[]
  /**
   * Enabled plugins' `bin/` directories (each existing `<pluginDir>/bin`). Prepended
   * to PATH for the agent's bash subprocesses so a plugin's bundled CLIs resolve by
   * bare name — mirrors Claude Code, where an enabled plugin's `bin/` is on the Bash
   * tool's PATH. Enablement is the trust gate: only enabled plugins contribute.
   */
  binDirs: string[]
  /** Synthesized MCP server records to merge into the lazy per-turn gather. */
  mcpServers: McpServerRecord[]
  /** Bundled skills to fold into the filesystem skill list. */
  skills: DiscoveredSkill[]
  /** Hooks collected from enabled plugins, each bound to its context. */
  hooks: LoadedPluginHook[]
  /**
   * Declarative Claude Code hook configs (`hooks/hooks.json`) from enabled
   * plugins — raw JSON + plugin root, merged with the settings-file hooks by the
   * cc-hooks runtime. Only enabled plugins contribute (enablement is the consent gate).
   */
  ccHooks: PluginHookConfig[]
  /**
   * Claude Code LSP server configs from enabled plugins (`lspServers` manifest field
   * / `.lsp.json` / strict:false marketplace entry), path-substituted. Registered with
   * the LSP feature, scoped to the project root — see `features/lsp/lsp-plugin-servers`.
   */
  lspServers: Array<{ pluginName: string; servers: Record<string, unknown> }>
  /**
   * Background monitors from enabled plugins (manifest `monitors` / `monitors/monitors.json`).
   * Spawned + streamed to the notification seam by the monitor host, NOT per turn. Only
   * enabled plugins contribute (the trust gate — see {@link LoadedPluginMonitor}).
   */
  monitors: LoadedPluginMonitor[]
  /** Long-running platform channels, each bound to its context. Started by the channel host, NOT per turn. */
  channels: Array<{ pluginName: string; channel: PluginChannel; ctx: PluginContext }>
  /** Declarative system-prompt sections from enabled plugins (manifest data, size-capped by schema). */
  promptSections: Array<{ pluginName: string; title: string; content: string }>
  /**
   * Custom worker ROLES (sub-agents) from enabled plugins — manifest data,
   * namespaced `<plugin>:<name>`. A forked skill that names one runs as it
   * (`boot/agent-refs.ts`).
   */
  agents: LoadedPluginAgent[]
  /** The active external memory provider, or null. At most ONE — first enabled plugin wins. */
  memory: { pluginName: string; provider: MemoryProvider; ctx: PluginContext } | null
  /**
   * Process-GLOBAL backend subsystems contributed by enabled plugins' `register()`
   * (route mount / resource provider / search provider / live WS frames / shutdown).
   * Collected here but NOT consumed per-run — the plugin backend HOST
   * ([[loadPluginBackends]] → backend-host.ts) reconciles them into the subsystem +
   * WS-frame registries, at boot and on every hot enable/disable. Empty for a normal
   * plugin that contributes only tools/hooks/skills. Each entry carries the owning
   * plugin's name so the host can diff wired-vs-desired per plugin, and the `revision` of the
   * code it came from (the entry's import identity) so the host re-wires a plugin whose code
   * changed instead of keeping the first instance it ever wired.
   */
  backends: Array<{
    pluginName: string
    projectId: string
    backend: BackendSubsystem
    revision: string
  }>
  /** Per-plugin summary for diagnostics / the prompt's plugin section. */
  loaded: Array<{
    name: string
    scope: 'global' | 'project'
    description: string
    toolNames: string[]
    skills: string[]
    mcpServers: string[]
    /** `<dir>/bin`, when it exists — the one contribution with no name of its own. */
    binDir?: string
    error?: string
  }>
  /** Installed, waiting on a decision, deliberately NOT loaded — names only (`ext/trust.ts`). */
  awaitingConsent: string[]
}

/**
 * A catalog with nothing in it — what a load starts from, and what a failed load degrades to.
 * One owner, so a field added to `LoadedPlugins` cannot be forgotten in one of the two. A
 * fresh object per call, because a load fills its result in place.
 */
export function emptyLoadedPlugins(): LoadedPlugins {
  return {
    tools: [],
    binDirs: [],
    mcpServers: [],
    skills: [],
    hooks: [],
    ccHooks: [],
    lspServers: [],
    monitors: [],
    channels: [],
    promptSections: [],
    agents: [],
    memory: null,
    backends: [],
    loaded: [],
    awaitingConsent: [],
  }
}

/**
 * Discover plugins for the scope, intersect with the user's enabled set, and load
 * each enabled plugin's contributions. Failures are isolated per-plugin: a bad
 * import or invalid MCP entry is recorded in `loaded[].error` and never aborts the
 * turn. Disabled or undiscovered plugins contribute nothing (and their code is
 * never imported).
 */
/**
 * Map one discovered plugin agent (manifest data or CC `agents/*.md`) into a
 * namespaced `LoadedPluginAgent`. CC tool names are normalized (Bash→bash, …);
 * `["*"]` means "all tools" → undefined (inherit the role's default tool surface).
 * `subst` substitutes plugin path vars + non-secret config into the prompt.
 */
export function buildLoadedAgent(
  pluginName: string,
  agent: PluginAgent,
  subst: (text: string) => string,
): LoadedPluginAgent {
  return {
    pluginName,
    name: agent.name,
    fullName: `${pluginName}:${agent.name}`,
    label: agent.label ?? agent.name,
    description: agent.description,
    prompt: subst(agent.prompt),
    ...(agent.tools && !agent.tools.includes('*')
      ? { tools: [...new Set(agent.tools.map(normalizeCcToolName))] }
      : {}),
    ...(agent.disallowedTools
      ? { disallowedTools: agent.disallowedTools.map(normalizeCcToolName) }
      : {}),
    ...(agent.preferredModel ? { preferredModel: agent.preferredModel } : {}),
    ...(agent.pinnedSkills?.length ? { pinnedSkills: agent.pinnedSkills } : {}),
    ...(agent.preferredEffort ? { preferredEffort: agent.preferredEffort } : {}),
  }
}
