import { z } from 'zod'
import { PLUGIN_NAME_RE } from './contracts-base'
import { pluginConfigOptionSchema } from './contracts-config'
import { pluginCommandSchema } from './contracts-commands'
import { pluginAgentSchema } from './contracts-agents'
import { pluginMonitorSchema, MONITORS_MAX_PER_PLUGIN } from './contracts-monitors'

const pathOrPaths = z.union([z.string(), z.array(z.string())])

/**
 * The runtime manifest a plugin loads with: Claude Code's `.claude-plugin/plugin.json` as
 * `layout/claude-code.ts` maps it (`userConfig` → `config`, `sensitive` → `secret`, …), or the
 * defaults of a plugin with none. Unknown keys are stripped. Path fields are resolved relative to
 * the plugin directory. Nothing here is a mini app's (rule X1): a plugin runs no Localix code.
 */
export const pluginManifestSchema = z.object({
  name: z
    .string()
    .regex(PLUGIN_NAME_RE, 'Plugin name must be letters, numbers, dashes or underscores.'),
  version: z.string().default('0.0.0'),
  /** The plugin's `userConfig` options, keyed by option name. */
  config: z.record(z.string(), pluginConfigOptionSchema).optional(),
  /**
   * Claude Code's "active before the user makes a choice". Read, never consent: every plugin is
   * untrusted until a rule says otherwise (`enable.ts`).
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
  /**
   * The plugin is in the Claude Code format, read in place (`layout/claude-code.ts`); absent for a
   * plugin with no manifest. `source`/`version`/`importedAt` remain on the root `plugin.json`
   * files earlier versions wrote at install, which are now ignored.
   */
  origin: z
    .object({
      format: z.literal('claude-code'),
      source: z.string().optional(),
      version: z.string().optional(),
      importedAt: z.string().optional(),
    })
    .optional(),
  /**
   * Whether the default `commands/` / `agents/` directories are scanned in addition to
   * the paths listed in `commands` / `agents` (default `true`, additive). `false` makes the
   * listed paths the only source — how a Claude Code plugin keeps its REPLACE rule.
   */
  defaultDirs: z
    .object({ commands: z.boolean().optional(), agents: z.boolean().optional() })
    .optional(),
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
      z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
    ])
    .optional(),
  /**
   * Claude Code declarative shell hooks. A path string to a hooks-json file, an INLINE hook
   * config object, or an array of either. They MERGE with the default `hooks/hooks.json`, which
   * loads first, as in Claude Code. Fed into the same cc-hooks pipeline the settings-file hooks use;
   * all five handler types (command/http/mcp_tool/prompt/agent) run on the events
   * this host dispatches (see `features/cc-hooks/contracts.ts` CC_HOOK_EVENTS).
   */
  hooks: z
    .union([
      z.string(),
      z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
      z.record(z.string(), z.unknown()),
    ])
    .optional(),
  /**
   * Claude Code LSP servers. A path string to a `.lsp.json` file, an INLINE map
   * `{ "<id>": { command, args?, extensionToLanguage, … } }`, or an array of either. They MERGE
   * with the default `.lsp.json`, which loads first; a later id replaces an earlier one. Enabled
   * plugins' servers are registered with the LSP feature, scoped to the project root
   * (see `features/lsp/lsp-plugin-servers.ts`). The `command` binary must be on PATH.
   */
  lspServers: z
    .union([
      z.string(),
      z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
      z.record(z.string(), z.unknown()),
    ])
    .optional(),
  /**
   * Custom worker ROLES (sub-agents) the plugin contributes. Either inline
   * objects (see {@link pluginAgentSchema}) OR — for Claude Code compatibility —
   * relative `./*.md` agent file paths (resolved in discovery, frontmatter
   * name/description + body→prompt). The default `agents/` directory is also
   * scanned. Selected as `<plugin>:<name>`. Not capped, as in Claude Code: no prompt lists a
   * plugin's roles, so their number costs no context.
   */
  agents: z.array(z.union([pluginAgentSchema, z.string()])).optional(),
  /**
   * Claude Code experimental background monitors — long-running commands whose
   * stdout lines surface to the model as notifications. Declared here (top-level)
   * or under `experimental.monitors` (promoted to this field before parse); absent →
   * the default `monitors/monitors.json` is read. A path string names another monitors file.
   * `when: "always"` monitors spawn while the plugin is enabled; an `on-skill-invoke:` monitor
   * starts the first time its skill runs in a chat (see monitor-host).
   */
  monitors: z
    .union([z.string(), z.array(pluginMonitorSchema).max(MONITORS_MAX_PER_PLUGIN)])
    .optional(),
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
  /**
   * Claude Code output styles, themes and workflows: paths that REPLACE the default
   * `output-styles/`, `themes/` and `workflows/` folders (`discovery-cc-components.ts`).
   */
  outputStyles: pathOrPaths.optional(),
  themes: pathOrPaths.optional(),
  workflows: pathOrPaths.optional(),
  /** Claude Code default settings (`agent`, `subagentStatusLine`); a root `settings.json` wins. */
  settings: z.record(z.string(), z.unknown()).optional(),
  /**
   * Claude Code channels: which of the plugin's MCP servers push messages into a chat. Their
   * `userConfig` options join the plugin's settings form (`layout/claude-code.ts`).
   */
  channels: z
    .array(z.object({ server: z.string(), displayName: z.string().optional() }))
    .optional(),
})
export type PluginManifest = z.infer<typeof pluginManifestSchema>
