import type { OutputStyleSummary } from './output-style-listing'
import type { CapabilityStores } from '../capabilities/store-factory'
import type { Kysely } from 'kysely'
import { type CapabilitySourceRecord, scalarConfig } from '../capabilities/source-repository'
import type { RuleChange } from '../capabilities/rule-changes'

import type { AppDatabase } from '../../db'
import { configFieldBase } from '../ext/config-fields'
import type { DiscoveredPlugin } from './discovery'
import type { MarketplaceListing } from './marketplace-registry'
import type {
  InstallPluginRequest,
  ListPluginCommandsResponse,
  PluginCommandSpec,
  ListPluginsResponse,
  PluginConfigField,
  PluginRecord,
  PluginValidation,
  RemovePluginRequest,
  UpdatePluginRequest,
  SetPluginConfigRequest,
  SetPluginEnabledRequest,
} from './contracts'
import type { PluginThemeSpec } from './contracts-themes'
import type { PluginUpdates } from './plugin-updates'
import type { DefaultMarketplaceOutcome } from './default-marketplaces'
import type { UpdateMarketplaceResponse } from './contracts-updates'

export interface PluginServiceDeps {
  db: Kysely<AppDatabase>
  /** Opens the capability source and rule stores (supplied by the composition root). */
  capabilityStores: CapabilityStores
  now?: () => string
  /** Resolves a project's working directory (for project-scoped discovery/install). */
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /** Resolves a session's working directory — the cwd a command's options script runs in. */
  resolveSessionCwd?: (userId: string, sessionId: string) => Promise<string | null>
  logger?: { warn: (msg: string, meta?: unknown) => void }
  /** Fired after any mutation (enable/config/install/remove) — e.g. to restart plugin channels. */
  onChanged?: () => void
  /**
   * The environment the update switches are read from (`DISABLE_AUTOUPDATER` and the rest, see
   * `marketplace-auto-update.ts`); the process's own by default.
   */
  env?: Record<string, string | undefined>
  /** The commit a remote git ref points at (`git ls-remote`); tests stub the network. */
  remoteCommit?: (url: string, ref?: string) => Promise<string | undefined>
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
}

/** Everything the capability snapshot shows of plugins, resolved from one catalog build. */
export interface PluginContributions {
  plugins: PluginRecord[]
  commands: PluginCommandSpec[]
  /** Color themes of enabled global plugins (`themes.ts`). */
  themes: PluginThemeSpec[]
}
export interface PluginService {
  listPlugins(userId: string, opts?: { projectId?: string | null }): Promise<ListPluginsResponse>
  listPluginContributions(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<PluginContributions>
  listPluginCommands(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<ListPluginCommandsResponse>
  /** Every output style the scope offers (`output-style-listing.ts`). */
  listOutputStyles(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ styles: OutputStyleSummary[] }>
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
  /**
   * Install from a source. `onPhase('installing')` is told once the source is fetched and the files
   * are being written (an update's progress row moves on). With `replace`, a marketplace copy whose
   * computed version is the one installed installs nothing and comes back `upToDate`.
   */
  install(
    userId: string,
    input: Omit<InstallPluginRequest, 'enable'> & { enable?: boolean },
    opts?: { replace?: boolean; onPhase?: (phase: 'installing') => void },
  ): Promise<PluginRecord>
  /** Validate a plugin folder in place, installed or not (`claude plugin validate <path>`). */
  validatePath(
    dir: string,
    opts?: { strict?: boolean },
  ): Promise<{ name: string; validation: PluginValidation }>
  /** Re-install from the original source (CC `plugin update` parity). */
  update(userId: string, input: UpdatePluginRequest): Promise<PluginRecord>
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
  /** List the registered marketplaces, each with whether it auto-updates. */
  listMarketplaces(userId: string): Promise<MarketplaceListing[]>
  /**
   * Refresh a registered marketplace's listing from its source, then update the plugins installed
   * from it (Claude Code's "Update marketplace"). `warnings` names the ones that failed.
   */
  updateMarketplace(
    userId: string,
    input: { name: string },
  ): Promise<{
    name: string
    count: number
    updated: string[]
    /** Installed from it, but left for the person to update (a `headersHelper` entry). */
    manual: string[]
    warnings: string[]
  }>
  /**
   * `marketplace update` with no name: refresh every marketplace's listing and leave the installed
   * plugins at their versions, as Claude Code does.
   */
  refreshMarketplaces(userId: string): Promise<UpdateMarketplaceResponse>
  /** The Marketplaces toggle: whether the background pass auto-updates this marketplace. */
  setMarketplaceAutoUpdate(
    userId: string,
    input: { name: string; autoUpdate: boolean },
  ): Promise<void>
  /**
   * Remove a registered marketplace and, as Claude Code does, uninstall the plugins installed from
   * it. Removing the official `localix` one is remembered: it is not registered again at start.
   */
  removeMarketplace(userId: string, input: { name: string }): Promise<{ uninstalled: string[] }>
  /**
   * Register the Store's default marketplaces — `localix`, the official and the community one —
   * for browsing, each unless it is there, the person removed it, or this run is offline
   * (`default-marketplaces.ts`). Run once at start.
   */
  ensureDefaultMarketplaces(): Promise<Record<string, DefaultMarketplaceOutcome>>
  /** Updates available, in flight, and the auto-update pass (`plugin-updates.ts`). */
  updates: PluginUpdates
  /** Notify all subscribers that plugins changed (mirrors CC's /reload-plugins; exposed as `/plugin reload`). */
  onChanged?(): void
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
    ...(opt.options?.length ? { enum: opt.options.map((value) => ({ value })) } : {}),
  }))
}
