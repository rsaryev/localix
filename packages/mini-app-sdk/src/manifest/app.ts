import { z } from 'zod'
import { miniAppManifestCoreSchema } from './index'
import {
  isAppRelativePath,
  MINI_APP_SCREENSHOTS_MAX,
  MINI_APP_TAG_RE,
  MINI_APP_TAGS_MAX,
  MINI_APP_NAME_RE,
  MINI_APP_QUALIFIED_NAME_RE,
} from './primitives'

/**
 * ── MINI APP MANIFEST ─────────────────────────────────────────────────────────
 * `.localix-mini-app/mini-app.json` in a mini app's folder, as a Claude Code plugin keeps its
 * `.claude-plugin/plugin.json`: the app, its backend, screens, settings and commands. Paths in it
 * are relative to the app's folder, the one that holds `.localix-mini-app/`. A mini app is Localix's own format and contains no Claude Code plugin, so a plugin's
 * keys (`skills`, `hooks`, `mcpServers`, …) are refused by name rather than ignored. What the agent
 * needs to know to use the app is its guide (`guide.md`), read on demand. See
 * `docs/internals/plugins-and-mini-apps.md`.
 *
 * The host validates the contribution arrays (`views`, `promptSections`) and a
 * command's `args` with the schemas of the subsystems that run them.
 */
export const MINI_APP_MANIFEST_DIR = '.localix-mini-app'
export const MINI_APP_MANIFEST_FILE = `${MINI_APP_MANIFEST_DIR}/mini-app.json`
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

/** A file of the app, named relative to its folder; the host serves it from there only. */
const appPathSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(isAppRelativePath, 'A path must stay inside the mini app folder: relative, with no ".."')

/** One store screenshot: shown at its own resolution in the store's detail page. */
export const miniAppScreenshotSchema = z
  .object({ path: appPathSchema, caption: z.string().max(140).optional() })
  .strict()

export const miniAppManifestSchema = miniAppManifestCoreSchema
  .extend({
    /** The JSON Schema an editor completes the file with; Localix does not read it. */
    $schema: z.string().optional(),
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
    /**
     * The app's icon in the store, the rail and the Dock (`media.ts` has the rules): a square
     * `.svg`, or a `.png`/`.webp` of at least 512×512, or an `.ico`. A published app needs one.
     */
    icon: appPathSchema.optional(),
    screenshots: z.array(miniAppScreenshotSchema).max(MINI_APP_SCREENSHOTS_MAX).optional(),
    /** Words the store filters by. */
    tags: z
      .array(
        z
          .string()
          .max(32)
          .regex(
            MINI_APP_TAG_RE,
            'A tag is lower-case words joined by dashes, such as "board-game"',
          ),
      )
      .max(MINI_APP_TAGS_MAX)
      .optional(),
    /** Native entrypoint(s) exporting `register(ctx)`: agent tools, routes, subsystems, hooks. */
    backend: z.union([z.string(), z.array(z.string())]).optional(),
    /** The agent's guide to the app, relative to the folder. */
    guide: z.string().default(`./${MINI_APP_GUIDE_FILE}`),
    commands: z
      .record(z.string().regex(MINI_APP_QUALIFIED_NAME_RE), miniAppCommandSchema)
      .optional(),
    views: z.array(z.unknown()).optional(),
    promptSections: z.array(z.unknown()).optional(),
  })
  .strict()
/** Author-written mini app manifest, before defaults. */
export type MiniAppManifestInput = z.input<typeof miniAppManifestSchema>
export type MiniAppManifest = z.output<typeof miniAppManifestSchema>
