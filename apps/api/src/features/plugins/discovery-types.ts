import type { PluginAgent, PluginCommand, PluginManifest, PluginProvides } from './contracts'
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
  /** Static capabilities (everything except native tool names, which need a load). */
  provides: PluginProvides
  /** Resolved slash-commands: inline manifest objects + Claude Code flat `.md` files. */
  commands: PluginCommand[]
  /** Resolved worker roles: inline manifest objects + Claude Code `agents/*.md` files. */
  agents: PluginAgent[]
  /** True for a managed first-party copy synchronized into the global Localix root. */
  bundled: boolean
  /** Manifest parse/validation error — the plugin still surfaces in the UI. */
  error?: string
  /**
   * True when the manifest had parse issues that were gracefully recovered (e.g.
   * unsupported config-option types were stripped). The plugin is NOT skipped by
   * the loader — `error` contains the non-fatal warning for the UI/validation report.
   */
  manifestRecovered?: boolean
}
