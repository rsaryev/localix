import type { PluginHookConfig } from '../cc-hooks'
import type { McpServerRecord } from '../mcp/repository'
import type { DiscoveredSkill } from '../agent-core/skill-discovery'
import { normalizeCcToolName } from './discovery'
import type { LocalixKey, PluginAgent, PluginMonitor } from './contracts'
import type { PluginOutputStyle } from './output-styles'

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
  /** CC `maxTurns:` — the most turns a delegated run of it takes. */
  maxTurns?: number
  /** CC `background:` — a delegated run never holds the delegating call, even when asked to. */
  background?: boolean
  /** CC `isolation: worktree` — a delegated run works in a git worktree of its own. */
  isolation?: 'isolated'
  /** CC `omitClaudeMd` — its runs read no workspace instruction file (`AGENTS.md`, `CLAUDE.md`). */
  omitClaudeMd?: boolean
  /** CC `experimental.cacheTtl` — the prompt cache lifetime of its runs. */
  cacheTtl?: '5m' | '1h'
  /** CC `autoCompactWindow` — its runs compact against this window (tokens). */
  autoCompactWindow?: number
  /** CC `memory` — its persistent-memory scope. */
  memory?: 'user' | 'project' | 'local'
  /** CC `initialPrompt` — leads the chat's first turn when it runs as the main session agent. */
  initialPrompt?: string
  /** The file's `localix:` key (priority, model route, memory scope). */
  localix?: LocalixKey
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
  lspServers: Array<{
    pluginName: string
    servers: Record<string, unknown>
    /** What each server process is given: the plugin's path variables (Claude Code exports them). */
    env?: Record<string, string>
  }>
  /**
   * Background monitors from enabled plugins (manifest `monitors` / `monitors/monitors.json`).
   * Spawned + streamed to the notification seam by the monitor host, NOT per turn. Only
   * enabled plugins contribute (the trust gate — see {@link LoadedPluginMonitor}).
   */
  monitors: LoadedPluginMonitor[]
  /**
   * Custom worker ROLES (sub-agents) from enabled plugins — manifest data,
   * namespaced `<plugin>:<name>`: the subagent types `delegate` runs a task as, as Claude Code's
   * Agent tool does (`agent-core/tools/delegate-agent-type.ts`).
   */
  agents: LoadedPluginAgent[]
  /**
   * Claude Code output styles from enabled plugins, offered as `<plugin>:<name>` (`/output-style`).
   * One marked `forceForPlugin` applies whenever its plugin is enabled; the first loaded wins.
   */
  outputStyles: PluginOutputStyle[]
  /**
   * The agent an enabled plugin's default settings (`settings.json` `agent`) run the main thread
   * as, while the person has not chosen another agent for the chat. The last loaded wins, as in
   * Claude Code.
   */
  mainAgent: LoadedPluginAgent | null
  /** Per-plugin summary for diagnostics / the prompt's plugin section. */
  loaded: Array<{
    name: string
    scope: 'global' | 'project'
    description: string
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
    binDirs: [],
    mcpServers: [],
    skills: [],
    ccHooks: [],
    lspServers: [],
    monitors: [],
    agents: [],
    outputStyles: [],
    mainAgent: null,
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
    // CC describes an agent whose file gives no description as `Agent from <plugin> plugin`.
    description: agent.description || `Agent from ${pluginName} plugin`,
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
    ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
    ...(agent.background ? { background: true } : {}),
    ...(agent.isolation ? { isolation: agent.isolation } : {}),
    ...(agent.omitClaudeMd ? { omitClaudeMd: true } : {}),
    ...(agent.cacheTtl ? { cacheTtl: agent.cacheTtl } : {}),
    ...(agent.autoCompactWindow ? { autoCompactWindow: agent.autoCompactWindow } : {}),
    ...(agent.memory ? { memory: agent.memory } : {}),
    ...(agent.initialPrompt ? { initialPrompt: subst(agent.initialPrompt) } : {}),
    ...(agent.localix ? { localix: agent.localix } : {}),
  }
}
