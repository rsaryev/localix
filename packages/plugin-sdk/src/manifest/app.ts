import { z } from 'zod'
import { pluginManifestCoreSchema } from './index'
import { PLUGIN_NAME_RE, PLUGIN_QUALIFIED_NAME_RE } from './primitives'

/**
 * ── MINI APP MANIFEST ─────────────────────────────────────────────────────────
 * `.localix-app/app.json`: the Localix layer of an extension. The agent's layer is a plugin in the
 * Claude Code format (`.claude-plugin/plugin.json` and its component folders), which knows nothing
 * of the mini app; the mini app names its plugin (the one in its folder, with the same name) and
 * adds what only Localix runs: a backend whose `register(ctx)` gives the agent tools over Localix's
 * APIs and serves routes, the native UI (`ui/register.tsx`, found by convention), sandboxed views,
 * prompt sections, typed contributions, file associations, settings, and how Localix offers its
 * plugin's commands. See `docs/internals/plugins-and-mini-apps.md`.
 *
 * The host validates the contribution arrays (`views`, `promptSections`, `contributions`) and a
 * command's `args` with the schemas of the subsystems that run them.
 */
export const MINI_APP_MANIFEST_DIR = '.localix-app'
export const MINI_APP_MANIFEST_FILE = `${MINI_APP_MANIFEST_DIR}/app.json`

/** How Localix offers one of the plugin's commands; the prompt stays the plugin's. */
export const miniAppCommandSchema = z.object({
  /** Argument chips and pickers in the composer; they assemble the command's argument string. */
  args: z.array(z.unknown()).optional(),
  /** Shown first in the slash menu, under "Suggested". */
  featured: z.boolean().optional(),
  /** Deferred tools the command's work needs, activated when it runs. */
  activateTools: z.array(z.string().min(1)).max(8).optional(),
})
export type MiniAppCommand = z.infer<typeof miniAppCommandSchema>

/** Author/owner: a bare string or the Claude Code object form (a marketplace entry's too). */
export const manifestAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
])

export const miniAppManifestSchema = pluginManifestCoreSchema.extend({
  name: z
    .string()
    .regex(PLUGIN_NAME_RE, 'A mini app name must be letters, numbers, dashes or underscores.'),
  /** The plugin's version wins when both declare one, as `plugin.json` wins in Claude Code. */
  version: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  author: manifestAuthorSchema.optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  /** Whether a bundled mini app starts enabled. */
  defaultEnabled: z.boolean().optional(),
  /** Native entrypoint(s) exporting `register(ctx)`: agent tools, routes, subsystems, hooks. */
  backend: z.union([z.string(), z.array(z.string())]).optional(),
  /** Other plugins the mini app needs, installed and enabled with it. */
  dependencies: z
    .array(z.union([z.string(), z.object({ name: z.string(), version: z.string().optional() })]))
    .optional(),
  /** Keyed by the plugin's command name (`review`, or `db:migrate` for a nested one). */
  commands: z.record(z.string().regex(PLUGIN_QUALIFIED_NAME_RE), miniAppCommandSchema).optional(),
  views: z.array(z.unknown()).optional(),
  promptSections: z.array(z.unknown()).optional(),
  contributions: z.array(z.unknown()).optional(),
})
/** Author-written mini app manifest, before defaults. */
export type MiniAppManifestInput = z.input<typeof miniAppManifestSchema>
export type MiniAppManifest = z.output<typeof miniAppManifestSchema>
