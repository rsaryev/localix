import type { CapabilityStores } from '../capabilities/store-factory'
import type { Kysely } from 'kysely'
import type { ContributionKindRegistry } from '../ext/contribution-kinds'
import { type CapabilitySourceRecord, scalarConfig } from '../capabilities/source-repository'
import type { RuleChange } from '../capabilities/rule-changes'

import type { AppDatabase } from '../../db'
import { configFieldBase } from '../ext/config-fields'
import type { DiscoveredPlugin } from './discovery'
import type { PluginAuthoring } from './authoring/service'
import type { MarketplaceListing } from './marketplace-registry'
import type { ArgOption } from './arg-options'
import type {
  InstallPluginRequest,
  ListPluginCommandsResponse,
  PluginCommandSpec,
  PluginViewSpec,
  ListPluginsResponse,
  PluginConfigField,
  PluginRecord,
  RemovePluginRequest,
  SetPluginConfigRequest,
  SetPluginEnabledRequest,
  InvokePluginUiActionRequest,
} from './contracts'
import type { PluginUiActionContext } from '@localixai/plugin-sdk/backend'

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
  pluginKitDir?: () => string
  /**
   * The user's home, root of the global `.localix/plugins` (see `discoverPlugins`). Required: Bun
   * reads the home once at process start, so reassigning `process.env.HOME` isolates nothing —
   * tests that did it staged their fixture plugins into the real home.
   */
  homeDir: string
  invokeUiAction?: (input: {
    pluginName: string
    action: string
    payload: unknown
    context: PluginUiActionContext
  }) => Promise<unknown>
}

/**
 * Every plugin-derived contribution of one scope, resolved from ONE catalog build —
 * the plugin half of the capability snapshot. Kept as one method (rather than three
 * calls) because discovery + DB state + the enable rule is the expensive part and it
 * is identical for all three projections.
 */
export interface PluginContributions {
  plugins: PluginRecord[]
  views: PluginViewSpec[]
  commands: PluginCommandSpec[]
}

export interface PluginService {
  syncBundledContributions(userId: string, projectId: string): Promise<void>
  listPlugins(userId: string, opts?: { projectId?: string | null }): Promise<ListPluginsResponse>
  listPluginContributions(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<PluginContributions>
  listPluginCommands(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<ListPluginCommandsResponse>
  /**
   * Resolve a plugin command arg's DYNAMIC options on demand (the composer's picker),
   * by running the plugin's declared `optionsScript`. Agnostic; never throws → `[]`.
   */
  resolvePluginArgOptions(
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
  listPluginViews(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ views: PluginViewSpec[] }>
  getViewHtml(
    userId: string,
    input: { pluginName: string; viewId: string; projectId?: string | null },
  ): Promise<{ html: string }>
  resolveUiFile(userId: string, input: { pluginName: string; file: string }): Promise<string>
  invokeUiAction(userId: string, input: InvokePluginUiActionRequest): Promise<{ result: unknown }>
  setEnabled(userId: string, input: SetPluginEnabledRequest): Promise<PluginRecord>
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
  install(
    userId: string,
    input: Omit<InstallPluginRequest, 'enable'> & { enable?: boolean },
    opts?: { replace?: boolean },
  ): Promise<PluginRecord>
  /** Re-install from the original source (CC `plugin update` parity). */
  update(userId: string, input: RemovePluginRequest): Promise<PluginRecord>
  /**
   * Remove a plugin (never cascades to dependents). When other installed plugins still
   * declare a dependency on it, returns `warnings` naming them (also logged).
   */
  remove(userId: string, input: RemovePluginRequest): Promise<{ warnings: string[] } | void>
  /** Register a marketplace from a source (owner/repo, git/https URL, or absolute path). */
  addMarketplace(
    userId: string,
    input: { source: string },
  ): Promise<{ name: string; count: number }>
  /** List marketplaces — the built-in `localix` first, then registered ones. */
  listMarketplaces(userId: string): Promise<MarketplaceListing[]>
  /** Remove a registered marketplace (the built-in `localix` cannot be removed). */
  removeMarketplace(userId: string, input: { name: string }): Promise<void>
  /** Notify all subscribers that plugins changed (mirrors CC's /reload-plugins; exposed as `/plugin reload`). */
  onChanged?(): void
  /** Creating and building the user's own plugins (`/plugin create`, the `plugin_build` tool). */
  authoring: PluginAuthoring
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
