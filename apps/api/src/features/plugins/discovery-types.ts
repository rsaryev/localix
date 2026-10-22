import type { PluginAgent, PluginCommand, PluginManifest, PluginProvides } from './contracts'
import type { PluginIssue } from '@localixai/claude-plugin'
import type { ResolvedEntrypoints } from './discovery-entrypoints'
import type { ExtensionLayout } from './layout/compose'

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
  /** Static capabilities (everything except native tool names, which need a load). */
  provides: PluginProvides
  /** Resolved slash-commands: inline manifest objects + Claude Code flat `.md` files. */
  commands: PluginCommand[]
  /** Resolved worker roles: inline manifest objects + Claude Code `agents/*.md` files. */
  agents: PluginAgent[]
  /** True for a managed first-party copy synchronized into the global Localix root. */
  bundled: boolean
  /**
   * Claude Code's `<name>@<marketplace>` when the folder is one Claude Code installed and Localix
   * reads in place (`claude-code-installs.ts`). Claude Code owns it: Localix may turn it off here,
   * never delete it.
   */
  claudeCodeInstall?: string
  /** A plugin (Claude Code format), a mini app with its plugin, or a legacy root `plugin.json`. */
  layout: ExtensionLayout
  /** What the plugin and mini-app formats' own rules found (unknown fields, unsupported parts). */
  layoutIssues?: PluginIssue[]
  /** Manifest parse/validation error — the plugin still surfaces in the UI. */
  error?: string
  /**
   * True when the manifest had parse issues that were gracefully recovered (e.g.
   * unsupported config-option types were stripped). The plugin is NOT skipped by
   * the loader — `error` contains the non-fatal warning for the UI/validation report.
   */
  manifestRecovered?: boolean
}
