import { z } from 'zod'
import { contributionInputSchema } from '../ext/contribution-input'
import { pluginManifestCoreSchema } from './contracts-base'
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
