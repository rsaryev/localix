import { z } from 'zod'
import { contributionInputSchema } from '../ext/contribution-input'
import { pluginManifestCoreSchema } from './contracts-base'
import { pluginConfigFieldSchema } from './contracts-config'
import {
  pluginPromptSectionSchema,
  pluginViewSchema,
  PROMPT_SECTIONS_MAX_PER_PLUGIN,
  VIEWS_MAX_PER_PLUGIN,
} from './contracts-contributions'
import { pluginCommandSchema } from './contracts-commands'
import { pluginAgentSchema, AGENTS_MAX_PER_PLUGIN } from './contracts-agents'
import { pluginMonitorSchema, MONITORS_MAX_PER_PLUGIN } from './contracts-monitors'

/**
 * Wire contracts for the plugin system. A plugin is a filesystem directory with a
 * `plugin.json` manifest that bundles any combination of: native JS tools, skills
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
 *   - `./contracts-base`          — shared `PLUGIN_NAME_RE` / `PLUGIN_API_VERSION`
 *   - `./contracts-config`        — config-option + config-field schemas
 *   - `./contracts-contributions` — prompt-section / view schemas
 *   - `./contracts-commands`      — slash-command arg/command/spec schemas
 *   - `./contracts-agents`        — custom sub-agent role schema
 */

export {
  PLUGIN_NAME_RE,
  PLUGIN_QUALIFIED_NAME_RE,
  PLUGIN_API_VERSION,
  pluginManifestCoreSchema,
} from './contracts-base'
export type { PluginManifestCore, PluginManifestCoreInput } from './contracts-base'
export {
  PLUGIN_SURFACE_AGENT,
  PLUGIN_SURFACE_WORKBENCH,
  normalizePluginSurfaces,
  isWorkbenchPlugin,
} from './contracts-base'
export {
  PLUGIN_CONFIG_TYPES,
  pluginConfigOptionSchema,
  pluginConfigFieldSchema,
} from './contracts-config'
export type {
  PluginConfigType,
  PluginConfigOption,
  PluginConfigOptionInput,
  PluginConfigField,
} from './contracts-config'
export {
  VIEWS_MAX_PER_PLUGIN,
  PLUGIN_VIEW_HTML_CAP_BYTES,
  PLUGIN_VIEW_ICON_RE,
  pluginViewSchema,
  pluginViewSpecSchema,
  listPluginViewsResponseSchema,
  pluginViewHtmlResponseSchema,
  pluginUiActionNameSchema,
  invokePluginUiActionRequestSchema,
  invokePluginUiActionResponseSchema,
  PROMPT_SECTIONS_MAX_PER_PLUGIN,
  PROMPT_SECTION_CONTENT_MAX_CHARS,
  pluginPromptSectionSchema,
} from './contracts-contributions'
export type { PluginViewSpec, InvokePluginUiActionRequest } from './contracts-contributions'
export {
  pluginCommandArgSchema,
  pluginCommandArgSpecSchema,
  pluginCommandSchema,
  pluginCommandSpecSchema,
  listPluginCommandsResponseSchema,
} from './contracts-commands'
export type {
  PluginCommandArg,
  PluginCommandArgSpec,
  PluginCommand,
  PluginCommandSpec,
  ListPluginCommandsResponse,
} from './contracts-commands'
export { AGENTS_MAX_PER_PLUGIN, pluginAgentSchema } from './contracts-agents'
export type { PluginAgent } from './contracts-agents'
export {
  MONITORS_MAX_PER_PLUGIN,
  pluginMonitorSchema,
  parseMonitors,
  isAlwaysMonitor,
  monitorSkillTrigger,
} from './contracts-monitors'
export type { PluginMonitor } from './contracts-monitors'

/** Structured validation outcome for a plugin (or one of its skills). */
export const pluginValidationSchema = z.object({
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type PluginValidation = z.infer<typeof pluginValidationSchema>

/**
 * `plugin.json` manifest. Unknown top-level keys are stripped (forward-compatible),
 * so a manifest written for a newer plugin host still loads here. Path fields are
 * resolved relative to the plugin directory.
 */
export const pluginManifestSchema = pluginManifestCoreSchema.extend({
  /** Native typed contributions; each kind's payload is validated by the owning subsystem. */
  contributions: z.array(contributionInputSchema).max(1000).optional(),
  /**
   * Whether this plugin is active before the user makes a choice. Honored only for
   * BUNDLED plugins (shipped with the app) — a dropped-in/installed plugin is always
   * opt-in regardless. Absent: code-free plugins default on, native-tool plugins off.
   */
  defaultEnabled: z.boolean().optional(),
  description: z.string().default(''),
  /**
   * Author — a bare string OR the Claude Code object form `{ name, email?, url? }`
   * (plugins-reference.md). Normalized to a display string so every downstream
   * consumer sees `string | undefined` regardless of which form the manifest used.
   */
  author: z
    .union([
      z.string(),
      z.object({
        name: z.string().optional(),
        email: z.string().optional(),
        url: z.string().optional(),
      }),
    ])
    .transform((a) => (typeof a === 'string' ? a : (a.name ?? a.email ?? a.url ?? '')))
    .optional(),
  /** Human-readable name shown in the UI (Claude Code `displayName`). Falls back to `name`. */
  displayName: z.string().optional(),
  homepage: z.string().optional(),
  /** Source code URL (Claude Code `repository`). Informational only. */
  repository: z.string().optional(),
  /** SPDX license identifier (Claude Code `license`). Informational only. */
  license: z.string().optional(),
  /** Discovery tags (Claude Code `keywords`). Informational only. */
  keywords: z.array(z.string()).optional(),
  /**
   * Provenance: where this plugin was migrated from — a source URL or marketplace
   * entry (e.g. a Claude Code plugin repo). Absent = written natively for Localix.
   * Purely informational (shown in Settings); set it when converting a foreign plugin.
   */
  migratedFrom: z.string().optional(),
  /** Native JS/TS entrypoint(s) exporting AgentTools (and optional hooks). Defaults to ./tools if present. */
  tools: z.union([z.string(), z.array(z.string())]).optional(),
  /** Bundled skill directory/directories holding `<name>/SKILL.md`. Defaults to ./skills if present. */
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * Slash-commands the plugin contributes. Either inline objects `{ name, description,
   * args, prompt }` (invoked namespaced as `/<plugin>:<name>`, the prompt template runs
   * as an agent macro with `${argName}` substituted) OR — for Claude Code compatibility
   * — relative `./*.md` file paths whose body becomes the command prompt (resolved in
   * discovery). The default `commands/` directory of flat `.md` files is also scanned.
   */
  commands: z.array(z.union([pluginCommandSchema, z.string()])).optional(),
  /** Bundled MCP servers: inline `{ name: { command|url, … } }`, a path string, or an array of paths. */
  mcpServers: z
    .union([
      z.record(z.string(), z.record(z.string(), z.unknown())),
      z.string(),
      z.array(z.string()),
    ])
    .optional(),
  /**
   * Claude Code declarative shell hooks. A path string to a hooks-json file, an
   * array of such paths, OR an INLINE hook config object (same `{ hooks: { <Event>:
   * [...] } }` shape as `hooks/hooks.json`). Absent → the default `hooks/hooks.json`
   * is loaded. Fed into the same cc-hooks pipeline the settings-file hooks use;
   * all five handler types (command/http/mcp_tool/prompt/agent) run on the events
   * this host dispatches (see `features/cc-hooks/contracts.ts` CC_HOOK_EVENTS).
   */
  hooks: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  /**
   * Claude Code LSP servers. A path string to a `.lsp.json` file, an array of such
   * paths, OR an INLINE map `{ "<id>": { command, args?, extensionToLanguage, … } }`
   * (same shape as `.lsp.json`). Absent → the default `.lsp.json` is loaded. Enabled
   * plugins' servers are registered with the LSP feature, scoped to the project root
   * (see `features/lsp/lsp-plugin-servers.ts`). The `command` binary must be on PATH.
   */
  lspServers: z
    .union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())])
    .optional(),
  /**
   * Declarative system-prompt sections injected while the plugin is enabled.
   * See {@link pluginPromptSectionSchema}; capped per plugin.
   */
  promptSections: z.array(pluginPromptSectionSchema).max(PROMPT_SECTIONS_MAX_PER_PLUGIN).optional(),
  /**
   * Sandboxed UI views the plugin contributes, each opened as a work-item TAB.
   * The single UI-surface contract — a legacy `panels` array is promoted into
   * this field before parse. See {@link pluginViewSchema}; capped per plugin.
   */
  views: z.array(pluginViewSchema).max(VIEWS_MAX_PER_PLUGIN).optional(),
  /**
   * Custom worker ROLES (sub-agents) the plugin contributes. Either inline
   * objects (see {@link pluginAgentSchema}) OR — for Claude Code compatibility —
   * relative `./*.md` agent file paths (resolved in discovery, frontmatter
   * name/description + body→prompt). The default `agents/` directory is also
   * scanned. Selected as `<plugin>:<name>`. Capped per plugin.
   */
  agents: z
    .array(z.union([pluginAgentSchema, z.string()]))
    .max(AGENTS_MAX_PER_PLUGIN)
    .optional(),
  /**
   * Claude Code experimental background monitors — long-running commands whose
   * stdout lines surface to the model as notifications. Declared here (top-level)
   * or under `experimental.monitors` (promoted to this field before parse); absent →
   * the default `monitors/monitors.json` is read.
   * `when: "always"` monitors spawn while the plugin is enabled; `on-skill-invoke:`
   * monitors are parsed + registered but their lazy start is deferred (see monitor-host).
   */
  monitors: z.array(pluginMonitorSchema).max(MONITORS_MAX_PER_PLUGIN).optional(),
  /**
   * Claude Code plugin-to-plugin dependencies: `["helper-lib", { name, version? }]`.
   * `version` is a semver RANGE (checked advisorily — mismatch warns, never blocks).
   * Resolved on marketplace install (same marketplace first, then marketplaces the
   * parent catalog lists in `allowCrossMarketplaceDependenciesOn`, then already-
   * installed/bundled plugins by name) and cascaded on enable — see `dependencies.ts`.
   */
  dependencies: z
    .array(z.union([z.string(), z.object({ name: z.string(), version: z.string().optional() })]))
    .optional(),
})
export type PluginManifest = z.infer<typeof pluginManifestSchema>

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
})

export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>

export const listMarketplacesResponseSchema = z.object({
  marketplaces: z.array(marketplaceListingSchema),
})

export const addMarketplaceResponseSchema = z.object({ name: z.string(), count: z.number() })
