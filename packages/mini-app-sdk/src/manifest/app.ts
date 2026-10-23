import { z } from 'zod'
import { miniAppManifestCoreSchema } from './index'
import { MINI_APP_NAME_RE, MINI_APP_QUALIFIED_NAME_RE } from './primitives'

/**
 * ── MINI APP MANIFEST ─────────────────────────────────────────────────────────
 * `mini-app.json` at the root of a mini app's folder: the app, its backend, screens, settings and
 * commands. A mini app is Localix's own format and contains no Claude Code plugin, so a plugin's
 * keys (`skills`, `hooks`, `mcpServers`, …) are refused by name rather than ignored. What the agent
 * needs to know to use the app is its guide (`guide.md`), read on demand. See
 * `docs/internals/plugins-and-mini-apps.md`.
 *
 * The host validates the contribution arrays (`views`, `promptSections`, `contributions`) and a
 * command's `args` with the schemas of the subsystems that run them.
 */
export const MINI_APP_MANIFEST_FILE = 'mini-app.json'
export const MINI_APP_GUIDE_FILE = 'guide.md'

/** Author/owner: a bare string or the object form. */
export const manifestAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
])

/** A command the mini app offers as `/<app>:<name>`; its prompt fills `${name}` from its args, and `$ARGUMENTS` with all of them. */
export const miniAppCommandSchema = z
  .object({
    description: z.string().default(''),
    prompt: z.string().min(1),
    /** Argument chips and pickers in the composer; they assemble the command's arguments. */
    args: z.array(z.unknown()).optional(),
    /** Placeholder shown in the composer while the command is selected. */
    argumentHint: z.string().optional(),
    /** Shown first in the slash menu, under "Suggested". */
    featured: z.boolean().optional(),
    /** Deferred tools the command's work needs, activated when it runs. */
    activateTools: z.array(z.string().min(1)).max(8).optional(),
  })
  .strict()
export type MiniAppCommand = z.infer<typeof miniAppCommandSchema>

export const miniAppManifestSchema = miniAppManifestCoreSchema
  .extend({
    name: z
      .string()
      .regex(MINI_APP_NAME_RE, 'A mini app name must be letters, numbers, dashes or underscores.'),
    version: z.string().min(1),
    description: z.string().min(1),
    displayName: z.string().optional(),
    author: manifestAuthorSchema.optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    /** Native entrypoint(s) exporting `register(ctx)`: agent tools, routes, subsystems, hooks. */
    backend: z.union([z.string(), z.array(z.string())]).optional(),
    /** The agent's guide to the app, relative to the folder. */
    guide: z.string().default(`./${MINI_APP_GUIDE_FILE}`),
    commands: z
      .record(z.string().regex(MINI_APP_QUALIFIED_NAME_RE), miniAppCommandSchema)
      .optional(),
    views: z.array(z.unknown()).optional(),
    promptSections: z.array(z.unknown()).optional(),
    contributions: z.array(z.unknown()).optional(),
  })
  .strict()
/** Author-written mini app manifest, before defaults. */
export type MiniAppManifestInput = z.input<typeof miniAppManifestSchema>
export type MiniAppManifest = z.output<typeof miniAppManifestSchema>
