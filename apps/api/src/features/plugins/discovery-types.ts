import type { PluginAgent, PluginCommand, PluginManifest, PluginProvides } from './contracts'
import type { PluginIssue } from '@localixai/claude-plugin'
import type { ResolvedEntrypoints } from './discovery-entrypoints'

export interface DiscoveredPlugin {
  manifest: PluginManifest
  /**
   * The raw parsed manifest object (pre-zod), kept so the validator can inspect
   * Claude Code spec fields our schema strips (lspServers, monitors, hooks-as-path…)
   * and flag cross-spec compatibility issues. Undefined on read/parse failure.
   */
  rawManifest?: Record<string, unknown>
  /** Absolute plugin directory. */
  dir: string
  scope: 'global' | 'project'
  /** '' for global; the active project id for project-scoped plugins. */
  projectId: string
  entrypoints: ResolvedEntrypoints
  /** Static capabilities: skills, MCP and LSP servers, commands and agents. */
  provides: PluginProvides
  /** Resolved slash-commands: inline manifest objects + Claude Code flat `.md` files. */
  commands: PluginCommand[]
  /** Resolved worker roles: inline manifest objects + Claude Code `agents/*.md` files. */
  agents: PluginAgent[]
  /**
   * Claude Code's `<name>@<marketplace>` when the folder is one Claude Code installed and Localix
   * reads in place (`claude-code-installs.ts`). Claude Code owns it: Localix may turn it off here,
   * never delete it.
   */
  claudeCodeInstall?: string
  /**
   * `<name>@<marketplace>` when the plugin loads in place from a marketplace added from a local
   * folder (`in-place-installs.ts`). The folder is the person's: an uninstall drops the record,
   * never the folder.
   */
  inPlaceInstall?: string
  /** What Claude Code's own rules found in the plugin (unknown fields, unsupported parts). */
  manifestIssues?: PluginIssue[]
  /** Manifest parse/validation error — the plugin still surfaces in the UI. */
  error?: string
}
