import type { McpServerRecord } from '../mcp/repository'
import type { PluginOutputStyle } from './output-styles'
import type { ScopePlugin } from './kit'

/**
 * WHAT A LOAD PRODUCES — the shape every consumer of `loadEnabledPlugins` reads.
 *
 * Split from the loader because the two change for different reasons: this is the contract
 * between a plugin's manifest and the runtime that consumes it, while `loader.ts` is the
 * orchestration that fills it in. A reader asking "what can a plugin contribute" should not
 * have to scroll past the import machinery to find out.
 */

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
  /**
   * Claude Code output styles from enabled plugins, offered as `<plugin>:<name>` (`/output-style`).
   * One marked `forceForPlugin` applies whenever its plugin is enabled; the first loaded wins.
   */
  outputStyles: PluginOutputStyle[]
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
  /**
   * Every plugin of the scope the kit loaded, with whether this agent may run it: what the run gives
   * the plugin host and its chat's session settings (`plugins/kit/sessions.ts`).
   */
  kitPlugins: ScopePlugin[]
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
    outputStyles: [],
    loaded: [],
    awaitingConsent: [],
    kitPlugins: [],
  }
}
