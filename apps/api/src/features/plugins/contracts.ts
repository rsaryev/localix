import { z } from 'zod'
import { pluginConfigFieldSchema } from './contracts-config'

/**
 * Wire contracts for plugins: Claude Code plugins, read from `.claude-plugin/plugin.json` and their
 * component folders (`layout/`). A plugin brings skills, commands, agents, hooks and a hooks module,
 * MCP and LSP servers, monitors, output styles and themes; it runs no Localix code of its own. Mini
 * apps have their own contracts (`features/mini-apps/contracts.ts`).
 *
 * The per-concern schema clusters live in sibling modules and are re-exported here.
 */

export { PLUGIN_ID_NAME_RE, PLUGIN_NAME_RE, PLUGIN_QUALIFIED_NAME_RE } from './contracts-base'

export type { PluginConfigType, PluginConfigOption, PluginConfigField } from './contracts-config'
export { pluginCommandSchema, pluginCommandSpecSchema } from './contracts-commands'
export type {
  MiniAppCommandArg,
  PluginCommand,
  PluginCommandSpec,
  ListPluginCommandsResponse,
} from './contracts-commands'
export { localixKeySchema, pluginAgentSchema } from './contracts-agents'
export type { LocalixKey, PluginAgent } from './contracts-agents'

export type { PluginMonitor } from './contracts-monitors'

/** Structured validation outcome for a plugin (or one of its skills). */
export const pluginValidationSchema = z.object({
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type PluginValidation = z.infer<typeof pluginValidationSchema>

export { pluginManifestSchema, type PluginManifest } from './contracts-manifest'

/** What a plugin contributes, for the settings UI. Static fields are known without
 * loading code; `tools` is only populated once an enabled plugin is loaded. */
export const pluginProvidesSchema = z.object({
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

/** A fully materialized plugin entry returned to the UI: manifest + state + provides. */
export const pluginRecordSchema = z.object({
  name: z.string(),
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
  /**
   * Where it came from: 'local' (dropped in / picked dir), a git URL, `<plugin>@<marketplace>`, or
   * 'builtin' for a plugin shipped inside Localix.
   */
  source: z.string(),
  /** Shipped inside Localix: it can be switched off, but not uninstalled or updated on its own. */
  builtin: z.boolean().optional(),
  enabled: z.boolean(),
  /**
   * Installed, not denied, and not running: nobody has allowed it yet.
   *
   * Distinct from `enabled: false`, which also covers a rule that says no. The screen shows
   * the two differently because the actions differ — one is a decision to make, the other is
   * a decision already made.
   */
  awaitingConsent: z.boolean().optional(),
  provides: pluginProvidesSchema,
  config: z.array(pluginConfigFieldSchema),
  /** Manifest/load error surfaced in the UI (invalid manifest, failed import…). */
  error: z.string().optional(),
  /** Structured manifest/command/skill validation outcome surfaced in the UI. */
  validation: pluginValidationSchema,
  /** On an update: the computed version is the one installed, so nothing was installed. */
  upToDate: z.boolean().optional(),
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
  /** The person accepted the entry's `headersHelper` command: the sha256 it was shown with. */
  acceptCommand: z.string().optional(),
})
export type InstallPluginRequest = z.infer<typeof installPluginRequestSchema>

export const removePluginRequestSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
})
export type RemovePluginRequest = z.infer<typeof removePluginRequestSchema>

/** `/plugin update`: the plugin, and the `headersHelper` command the person accepted, if any. */
export const updatePluginRequestSchema = removePluginRequestSchema.extend({
  acceptCommand: z.string().optional(),
})
export type UpdatePluginRequest = z.infer<typeof updatePluginRequestSchema>

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

/** One row in the marketplace listing: every registered marketplace. */
export const marketplaceListingSchema = z.object({
  name: z.string(),
  count: z.number(),
  plugins: z.array(marketplaceListingPluginSchema).optional(),
  /** Why a registered marketplace cannot be used (a Claude Code-only catalog), with a hint. */
  unsupported: z.string().optional(),
  /** Whether the background pass refreshes it and updates its plugins. */
  autoUpdate: z.boolean().optional(),
  /** An environment variable turns the pass off, so the toggle is hidden (as in Claude Code). */
  autoUpdatePaused: z.boolean().optional(),
  /** Localix's official marketplace (`localix`, from `rsaryev/localix`). */
  official: z.boolean().optional(),
  /** When its listing was last fetched. */
  lastUpdated: z.string().optional(),
})

export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>

export const listMarketplacesResponseSchema = z.object({
  marketplaces: z.array(marketplaceListingSchema),
})

export const addMarketplaceResponseSchema = z.object({ name: z.string(), count: z.number() })
