import type { PluginCommand, PluginManifest, PluginProvides } from './contracts'
import type { ResolvedEntrypoints } from './kit'
import type { Plugin as KitPlugin } from '@rsaryev/llx-plugin/loading'
import type { AgentRecord, PluginIssue } from '@rsaryev/llx-plugin/format'

export interface DiscoveredPlugin {
  manifest: PluginManifest
  /**
   * The raw parsed manifest object (pre-zod), kept so the validator can inspect
   * Claude Code spec fields our schema strips (lspServers, monitors, hooks-as-path…)
   * and flag cross-spec compatibility issues. Undefined on read/parse failure.
   */
  rawManifest?: Record<string, unknown>
  /** The plugin as the kit loaded it; absent when it did not load. */
  kit?: KitPlugin
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
  /** Its agents as the kit read their files. */
  agents: readonly AgentRecord[]
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
  /**
   * A user-scope copy installed from a marketplace into the version cache (`plugin-cache.ts`):
   * its `<name>@<marketplace>` and the resolved version it was installed at.
   */
  cachedInstall?: { id: string; version: string }
  /** What Claude Code's own rules found in the plugin (unknown fields, unsupported parts). */
  manifestIssues?: PluginIssue[]
  /** Manifest parse/validation error — the plugin still surfaces in the UI. */
  error?: string
}
