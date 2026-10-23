import type { OutputStyleSummary } from './output-style-listing'
import type { CapabilityStores } from '../capabilities/store-factory'
import type { Kysely } from 'kysely'
import type { ContributionKindRegistry } from '../ext/contribution-kinds'
import { type CapabilitySourceRecord, scalarConfig } from '../capabilities/source-repository'
import type { RuleChange } from '../capabilities/rule-changes'

import type { AppDatabase } from '../../db'
import { configFieldBase } from '../ext/config-fields'
import type { DiscoveredPlugin } from './discovery'
import type { MiniAppAuthoring } from './authoring/service'
import type { MarketplaceListing } from './marketplace-registry'
import type { ArgOption } from './arg-options'
import type {
  InstallPluginRequest,
  ListPluginCommandsResponse,
  PluginCommandSpec,
  MiniAppViewSpec,
  ListPluginsResponse,
  PluginConfigField,
  PluginRecord,
  PluginValidation,
  RemovePluginRequest,
  SetPluginConfigRequest,
  SetPluginEnabledRequest,
  InvokeMiniAppUiActionRequest,
} from './contracts'
import type { MiniAppUiActionContext } from '@localixai/mini-app-sdk/backend'
import type { PluginThemeSpec } from './contracts-themes'

export interface PluginServiceDeps {
  db: Kysely<AppDatabase>
  /** Opens the capability source and rule stores (supplied by the composition root). */
  capabilityStores: CapabilityStores
  /** Host-owned schemas. Without a registry, no contribution kind is accepted. */
  contributionKinds?: ContributionKindRegistry
  now?: () => string
  /** Resolves a project's working directory (for project-scoped discovery/install). */
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /** Resolves a session's working directory — the cwd a command's options script runs in. */
  resolveSessionCwd?: (userId: string, sessionId: string) => Promise<string | null>
  logger?: { warn: (msg: string, meta?: unknown) => void }
  /** Fired after any mutation (enable/config/install/remove) — e.g. to restart plugin channels. */
  onChanged?: () => void
  /** Where the plugin kit is; defaults to the one shipped beside the staged plugins. */
  miniAppKitDir?: () => string
  /**
   * The user's home, root of the global `.localix/plugins` (see `discoverPlugins`). Required: Bun
   * reads the home once at process start, so reassigning `process.env.HOME` isolates nothing —
   * tests that did it staged their fixture plugins into the real home.
   */
  homeDir: string
  /**
   * The commands loaded mods registered (`$.command.register`), listed beside the plugins'
   * own; a mods host supplies them (`bootstrap/mods.ts`).
   */
  modCommands?: () => ReadonlyArray<{
    plugin: string
    name: string
    description: string
    argumentHint?: string
  }>
  invokeUiAction?: (input: {
    pluginName: string
    action: string
    payload: unknown
    context: MiniAppUiActionContext
  }) => Promise<unknown>
}

/**
 * Every plugin-derived contribution of one scope, resolved from ONE catalog build —
 * the plugin half of the capability snapshot. Kept as one method (rather than three
 * calls) because discovery + DB state + the enable rule is the expensive part and it
 * is identical for all three projections.
 */
export interface MiniAppContributions {
  plugins: PluginRecord[]
  views: MiniAppViewSpec[]
  commands: PluginCommandSpec[]
  /** Color themes of enabled global plugins (`themes.ts`). */
  themes: PluginThemeSpec[]
}

export interface PluginService {
  syncBundledContributions(userId: string, projectId: string): Promise<void>
  listPlugins(userId: string, opts?: { projectId?: string | null }): Promise<ListPluginsResponse>
  listMiniAppContributions(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<MiniAppContributions>
  listPluginCommands(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<ListPluginCommandsResponse>
  /**
   * Resolve a plugin command arg's DYNAMIC options on demand (the composer's picker),
   * by running the plugin's declared `optionsScript`. Agnostic; never throws → `[]`.
   */
  resolveMiniAppArgOptions(
    userId: string,
    input: {
      plugin: string
      command: string
      arg: string
      query?: string
      sessionId?: string
      projectId?: string | null
    },
  ): Promise<{ options: ArgOption[] }>
  listMiniAppViews(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ views: MiniAppViewSpec[] }>
  /** Every output style the scope offers (`output-style-listing.ts`). */
  listOutputStyles(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ styles: OutputStyleSummary[] }>
  getViewHtml(
    userId: string,
    input: { pluginName: string; viewId: string; projectId?: string | null },
  ): Promise<{ html: string }>
  resolveUiFile(userId: string, input: { pluginName: string; file: string }): Promise<string>
  invokeUiAction(userId: string, input: InvokeMiniAppUiActionRequest): Promise<{ result: unknown }>
  /**
   * Switch a plugin on or off. Disabling one that another enabled plugin depends on is refused
   * (`plugin_has_dependents`) unless `ignoreDependents`; `refuseNoop` also refuses a switch that
   * changes nothing (`plugin_already_in_state`), as `claude plugin enable|disable` does.
   */
  setEnabled(
    userId: string,
    input: SetPluginEnabledRequest,
    opts?: { refuseNoop?: boolean; ignoreDependents?: boolean },
  ): Promise<PluginRecord>
  /**
   * The extra rule changes an allow on these plugins implies — their installed, still-inert
   * dependencies. Planned rather than written so the caller lands them in ONE transaction
   * with the change that caused them; a plugin allowed without its dependencies is the
   * failure this exists to prevent. Never widens past the trust gate: a non-bundled plugin
   * carrying native code is reported, not enabled.
   */
  planPolicyCascade(
    userId: string,
    scope: { projectId?: string | null; agentId?: string | null },
    names: readonly string[],
  ): Promise<RuleChange[]>
  /** React to these plugins' rules having changed: drop inspection caches, re-wire hosts. */
  onPolicyChanged(
    userId: string,
    scope: { projectId?: string | null; agentId?: string | null },
    names: readonly string[],
  ): Promise<void>
  setConfig(userId: string, input: SetPluginConfigRequest): Promise<PluginRecord>
  /**
   * Rewrite config an older build stored in a shape `setConfig` no longer writes (a sensitive
   * value in plain text, a user-scope plugin's per-project copy). Run at boot; idempotent.
   */
  reconcileStoredConfig(userId: string): Promise<number>
  install(
    userId: string,
    input: Omit<InstallPluginRequest, 'enable'> & { enable?: boolean },
    opts?: { replace?: boolean },
  ): Promise<PluginRecord>
  /** Validate a plugin folder in place, installed or not (`claude plugin validate <path>`). */
  validatePath(
    dir: string,
    opts?: { strict?: boolean },
  ): Promise<{ name: string; validation: PluginValidation }>
  /** Re-install from the original source (CC `plugin update` parity). */
  update(userId: string, input: RemovePluginRequest): Promise<PluginRecord>
  /**
   * Remove a plugin (never cascades to dependents). When other installed plugins still
   * declare a dependency on it, returns `warnings` naming them (also logged). A name that is not
   * installed is a `plugin_not_found` error. A plugin Claude Code installed is not deleted: it is
   * disabled here, and `claudeCodeInstall` names it so the caller can say so.
   */
  remove(
    userId: string,
    input: RemovePluginRequest,
  ): Promise<{ warnings: string[]; claudeCodeInstall?: string } | void>
  /** Register a marketplace from a source (owner/repo, git/https URL, or absolute path). */
  addMarketplace(
    userId: string,
    input: { source: string },
  ): Promise<{ name: string; count: number }>
  /** List marketplaces — the built-in `localix` first, then registered ones. */
  listMarketplaces(userId: string): Promise<MarketplaceListing[]>
  /**
   * Refresh a registered marketplace's listing from its source, then update the plugins installed
   * from it (Claude Code's "Update marketplace"). `warnings` names the ones that failed.
   */
  updateMarketplace(
    userId: string,
    input: { name: string },
  ): Promise<{ name: string; count: number; updated: string[]; warnings: string[] }>
  /**
   * Remove a registered marketplace (the built-in `localix` cannot be removed) and, as Claude Code
   * does, uninstall the plugins installed from it.
   */
  removeMarketplace(userId: string, input: { name: string }): Promise<{ uninstalled: string[] }>
  /** Notify all subscribers that plugins changed (mirrors CC's /reload-plugins; exposed as `/plugin reload`). */
  onChanged?(): void
  /** Creating and building the user's own plugins (`/plugin create`, the `plugin_build` tool). */
  authoring: MiniAppAuthoring
}

/** Build the UI's config field list, masking secret values to set/unset. */
export function toConfigFields(
  plugin: DiscoveredPlugin,
  state: CapabilitySourceRecord | undefined,
): PluginConfigField[] {
  const declared = plugin.manifest.config ?? {}
  const stored = scalarConfig(state?.config) ?? {}
  return Object.entries(declared).map(([key, opt]) => ({
    ...configFieldBase(key, opt, stored),
    type: opt.type,
    description: opt.description,
    required: opt.required,
    secret: opt.secret,
    // CC-spec optional fields — pass through when present so the UI can use them.
    ...(opt.title !== undefined ? { title: opt.title } : {}),
    ...(opt.multiple !== undefined ? { multiple: opt.multiple } : {}),
    ...(opt.min !== undefined ? { min: opt.min } : {}),
    ...(opt.max !== undefined ? { max: opt.max } : {}),
  }))
}
