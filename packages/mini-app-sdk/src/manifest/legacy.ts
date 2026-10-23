import { z } from 'zod'
import { manifestAuthorSchema } from './app'
import { miniAppManifestCoreSchema } from './index'
import { PLUGIN_NAME_RE, PLUGIN_QUALIFIED_NAME_RE } from './primitives'

/**
 * ── BEFORE THE SPLIT ──────────────────────────────────────────────────────────
 * `.localix-app/app.json` decorated a Claude Code plugin in the same folder. The host reads it
 * only to carry an existing install over to `mini-app.json`; no mini app imports this module, so
 * it costs none of them anything.
 */
export const LEGACY_MINI_APP_MANIFEST_DIR = '.localix-app'
export const LEGACY_MINI_APP_MANIFEST_FILE = `${LEGACY_MINI_APP_MANIFEST_DIR}/app.json`

/** How Localix offers one of the plugin's commands; the prompt stays the plugin's. */
export const legacyMiniAppCommandSchema = z.object({
  /** Argument chips and pickers in the composer; they assemble the command's argument string. */
  args: z.array(z.unknown()).optional(),
  /** Shown first in the slash menu, under "Suggested". */
  featured: z.boolean().optional(),
  /** Deferred tools the command's work needs, activated when it runs. */
  activateTools: z.array(z.string().min(1)).max(8).optional(),
})
export type LegacyMiniAppCommand = z.infer<typeof legacyMiniAppCommandSchema>

export const legacyMiniAppManifestSchema = miniAppManifestCoreSchema.extend({
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
  commands: z
    .record(z.string().regex(PLUGIN_QUALIFIED_NAME_RE), legacyMiniAppCommandSchema)
    .optional(),
  views: z.array(z.unknown()).optional(),
  promptSections: z.array(z.unknown()).optional(),
  contributions: z.array(z.unknown()).optional(),
})
export type LegacyMiniAppManifest = z.output<typeof legacyMiniAppManifestSchema>
