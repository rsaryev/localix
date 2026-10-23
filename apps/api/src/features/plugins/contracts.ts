import { z } from 'zod'
import { pluginManifestCoreSchema } from './contracts-base'
import { pluginConfigFieldSchema } from './contracts-config'

/**
 * Wire contracts for the plugin system. A plugin is a filesystem directory with a
 * runtime manifest — composed from a Claude Code `.claude-plugin/plugin.json` and a mini app's
 * `.localix-app/app.json` (`layout/compose.ts`), or read from a legacy root `plugin.json` — that
 * bundles any combination of: native JS tools, skills
 * (SKILL.md), MCP servers, slash-command prompts, and lifecycle hooks. Discovery is
 * filesystem-based (like skills); enable-state and per-plugin config live in the DB
 * (like MCP servers), so dropping a directory in never silently runs code — a plugin
 * is inert until explicitly enabled (the trust gate for in-process native tools).
 *
 * These mirror the MCP/skill management shape: scoped CRUD validated at the route
 * boundary, one source of truth shared by the runtime loader and the settings UI.
 *
 * The per-concern schema clusters live in sibling modules and are re-exported here so
 * the manifest barrel stays the single import surface:
 *   - `./contracts-manifest`      — the full runtime manifest schema
 *   - `./contracts-base`          — shared `PLUGIN_NAME_RE` / `PLUGIN_API_VERSION`
 *   - `./contracts-config`        — config-option + config-field schemas
 *   - `./contracts-contributions` — prompt-section / view schemas
 *   - `./contracts-commands`      — slash-command arg/command/spec schemas
 *   - `./contracts-agents`        — custom sub-agent role schema
 */

export { PLUGIN_NAME_RE, PLUGIN_QUALIFIED_NAME_RE, PLUGIN_API_VERSION } from './contracts-base'

export { pluginConfigOptionSchema } from './contracts-config'
export type { PluginConfigType, PluginConfigOption, PluginConfigField } from './contracts-config'
export {
  PLUGIN_VIEW_HTML_CAP_BYTES,
  pluginViewSpecSchema,
  pluginViewHtmlResponseSchema,
  invokePluginUiActionRequestSchema,
  invokePluginUiActionResponseSchema,
} from './contracts-contributions'
export type { PluginViewSpec, InvokePluginUiActionRequest } from './contracts-contributions'
export { pluginCommandSchema, pluginCommandSpecSchema } from './contracts-commands'
export type {
  PluginCommandArg,
  PluginCommand,
  PluginCommandSpec,
  ListPluginCommandsResponse,
} from './contracts-commands'
export { pluginAgentSchema } from './contracts-agents'
export type { PluginAgent } from './contracts-agents'

export type { PluginMonitor } from './contracts-monitors'

/** Structured validation outcome for a plugin (or one of its skills). */
export const pluginValidationSchema = z.object({
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type PluginValidation = z.infer<typeof pluginValidationSchema>

export { pluginManifestSchema, type PluginManifest } from './contracts-manifest'

/** Model-facing metadata read from an enabled plugin's live AgentTool definitions. */
export const pluginToolDescriptorSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
})
export type PluginToolDescriptor = z.infer<typeof pluginToolDescriptorSchema>

/** What a plugin contributes, for the settings UI. Static fields are known without
 * loading code; `tools` is only populated once an enabled plugin is loaded. */
export const pluginProvidesSchema = z.object({
  /** True when the manifest declares a native-tools entrypoint (in-process JS). */
  hasNativeTools: z.boolean(),
  /** Live tool descriptors exposed by the native entrypoint (enabled plugins only). */
  tools: z.array(pluginToolDescriptorSchema),
  /** Backend subsystem ids returned by enabled native entrypoints (routes/resources/context). */
  backendSubsystems: z.array(z.string()).optional(),
  /** Bundled skill names (known statically from the skills dir). */
  skills: z.array(z.string()),
  /** Bundled MCP server names (known statically from the manifest / .mcp.json). */
  mcpServers: z.array(z.string()),
  /** Slash-command names declared inline in the manifest's `commands` array. */
  commands: z.array(z.string()),
  /** Custom sub-agent role names (`<plugin>:<name>`) the plugin contributes. */
  agents: z.array(z.string()).optional(),
  /** Claude Code LSP server ids the plugin declares (`lspServers` / `.lsp.json`). */
  lspServers: z.array(z.string()).optional(),
})
export type PluginProvides = z.infer<typeof pluginProvidesSchema>

/**
 * A bundled plugin's workbench UI artifact, as URLs the host imports and a revision that moves
 * exactly when the UI changed (see `ui-artifact.ts`).
 */
export const pluginUiDescriptorSchema = z.object({
  entry: z.string(),
  styles: z.array(z.string()),
  revision: z.string(),
})
export type PluginUiDescriptor = z.infer<typeof pluginUiDescriptorSchema>

/** A fully materialized plugin entry returned to the UI: manifest + state + provides. */
export const pluginRecordSchema = z.object({
  name: z.string(),
  /** Primary launcher group; absent in older or third-party manifests. */
  category: pluginManifestCoreSchema.shape.category,
  /** Human-readable label (Claude Code `displayName`); falls back to `name`. */
  displayName: z.string().optional(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  /** Provenance from the manifest: source it was migrated from; absent = native. */
  migratedFrom: z.string().optional(),
  /** Set when the plugin is a Claude Code plugin, loaded in place. */
  importedFrom: z.literal('claude-code').optional(),
  /**
   * What the folder holds: a `plugin` in the Claude Code format, a `mini-app` with its plugin,
   * or a `legacy` root `plugin.json` (docs/internals/plugins-and-mini-apps.md).
   */
  layout: z.enum(['plugin', 'mini-app', 'legacy']),
  /**
   * The surfaces the plugin declares it extends (normalized; `['agent']` when the
   * manifest says nothing). Consumers group by it — see `isWorkbenchPlugin`.
   */
  surfaces: z.array(z.string()),
  /** '' = global (`~/.localix/plugins`); otherwise the project id this plugin is scoped to. */
  projectId: z.string(),
  scope: z.enum(['global', 'project']),
  /** Absolute plugin directory. */
  dir: z.string(),
  /**
   * True when `dir` is the plugin's own folder in a marketplace added from a local folder: it
   * loads in place, so an edit there takes effect at `/plugin reload` with no update.
   */
  loadsInPlace: z.boolean().optional(),
  /** Where it came from: 'local' (dropped in / picked dir) or a git URL. */
  source: z.string(),
  enabled: z.boolean(),
  /**
   * Installed, not denied, and not running: nobody has allowed it yet.
   *
   * Distinct from `enabled: false`, which also covers a rule that says no. The screen shows
   * the two differently because the actions differ — one is a decision to make, the other is
   * a decision already made.
   */
  awaitingConsent: z.boolean().optional(),
  /** True for plugins discovered from the repo's bundled `plugins/` root (ship for everyone). */
  bundled: z.boolean(),
  /** The built workbench UI a bundled plugin ships; absent when it has none. */
  ui: pluginUiDescriptorSchema.optional(),
  provides: pluginProvidesSchema,
  config: z.array(pluginConfigFieldSchema),
  /** Manifest/load error surfaced in the UI (invalid manifest, failed import…). */
  error: z.string().optional(),
  /** Structured manifest/command/skill validation outcome surfaced in the UI. */
  validation: pluginValidationSchema,
  /** On an install: the dependencies it installed alongside, which the success message names. */
  installedDependencies: z.array(z.string()).optional(),
})
export type PluginRecord = z.infer<typeof pluginRecordSchema>

export const listPluginsResponseSchema = z.object({ plugins: z.array(pluginRecordSchema) })
export type ListPluginsResponse = z.infer<typeof listPluginsResponseSchema>

/** Toggle a discovered plugin on/off for a scope. */
export const setPluginEnabledRequestSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
  /** Switch it for ONE agent instead of the project. A handle wins over a project id. */
  agentId: z.string().optional(),
  enabled: z.boolean(),
})
export type SetPluginEnabledRequest = z.infer<typeof setPluginEnabledRequestSchema>

/** Update a plugin's stored config values. Omit / send '' for a secret to keep it unchanged. */
export const setPluginConfigRequestSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
})
export type SetPluginConfigRequest = z.infer<typeof setPluginConfigRequestSchema>

/**
 * Install a plugin into `~/.localix/plugins` (global) or a project's `.localix/plugins`.
 * `source` is a local absolute directory path or a git URL (https/ssh/`owner/repo`).
 * This is a lightweight install (copy / `git clone`), not a versioned marketplace.
 */
export const installPluginRequestSchema = z.object({
  source: z.string().min(1),
  projectId: z.string().nullable().optional(),
  /** Explicit installation is consent to run; callers may opt out with `false`. */
  enable: z.boolean().default(true),
})
export type InstallPluginRequest = z.infer<typeof installPluginRequestSchema>

export const removePluginRequestSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
})
export type RemovePluginRequest = z.infer<typeof removePluginRequestSchema>

/** Register a marketplace from a source (owner/repo, git/https URL, or absolute path). */
export const addMarketplaceRequestSchema = z.object({ source: z.string().min(1) })

/** Remove a registered marketplace by its catalog name. */
export const removeMarketplaceRequestSchema = z.object({ name: z.string().min(1) })

/**
 * Per-entry summary on a marketplace listing row. `relevance` is the CC 2.1.152+
 * project-affinity hint block (filePatterns/directoryNames/keywords), parsed + typed
 * so UI/agent surfaces can consume it; suggestion RANKING is deferred (no scorer yet).
 */
export const marketplaceListingPluginSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  relevance: z
    .object({
      filePatterns: z.array(z.string()).optional(),
      directoryNames: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
    })
    .optional(),
})

/** One row in the marketplace listing (built-in `localix` first, then registered). */
export const marketplaceListingSchema = z.object({
  name: z.string(),
  builtin: z.boolean(),
  count: z.number(),
  plugins: z.array(marketplaceListingPluginSchema).optional(),
  /** Why a registered marketplace cannot be used (a Claude Code-only catalog), with a hint. */
  unsupported: z.string().optional(),
})

export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>

export const listMarketplacesResponseSchema = z.object({
  marketplaces: z.array(marketplaceListingSchema),
})

export const addMarketplaceResponseSchema = z.object({ name: z.string(), count: z.number() })
