import { z } from 'zod'

/**
 * plugin.json manifest primitives — the common core schema, constants, and pure
 * helpers shared between the host's full zod schema (`apps/api` plugins feature)
 * and external tooling (the template, plugin-builder, marketplaces). The host
 * extends the core with the contributions it implements and re-exports these
 * primitives so there is exactly one statement of each cross-host rule.
 */

import { PLUGIN_NAME_RE, MINI_APP_CATEGORIES, MINI_APP_CONFIG_TYPES } from './primitives'

export {
  PLUGIN_NAME_RE,
  PLUGIN_QUALIFIED_NAME_RE,
  MINI_APP_API_VERSION,
  MINI_APP_SURFACE_AGENT,
  MINI_APP_SURFACE_WORKBENCH,
  MINI_APP_CATEGORIES,
  MINI_APP_CONFIG_TYPES,
  normalizeMiniAppSurfaces,
  isWorkbenchMiniApp,
} from './primitives'
export type { MiniAppCategory, MiniAppConfigType } from './primitives'

/**
 * One user-config option declared under `plugin.json.config`. Values remain scalar
 * even when `multiple` is set: that Claude Code compatibility field is an authoring
 * hint, not an array storage mode. `title`, `min`, and `max` are hints too; a host may
 * choose whether to render or enforce them.
 */
export const miniAppConfigOptionSchema = z.object({
  type: z.enum(MINI_APP_CONFIG_TYPES).default('string'),
  description: z.string().default(''),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  title: z.string().optional(),
  multiple: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})
/** Author-written shape before schema defaults are applied. */
export type MiniAppConfigOptionInput = z.input<typeof miniAppConfigOptionSchema>
/** Normalized config option after parsing. */
export type MiniAppConfigOption = z.output<typeof miniAppConfigOptionSchema>

/**
 * ── OS FILE ASSOCIATIONS ───────────────────────────────────────────────────────
 * A plugin that ships a dedicated viewer/editor for a file family declares that
 * family HERE, so the desktop bundle can tell the operating system "Localix opens
 * these". Runtime routing already lives beside the viewer (`host.fileEditors` /
 * `registerDedicatedViewerTypes`); this manifest field is the same knowledge
 * projected onto the ONE surface a runtime registry cannot reach — the app bundle's
 * `Info.plist` (macOS), NSIS/MSI registry writes (Windows) and `.desktop` `MimeType=`
 * (Linux), all of which are frozen at package time.
 *
 * The desktop packaging step aggregates every BUNDLED plugin's declarations into
 * `apps/desktop-tauri/src-tauri/tauri.conf.json` (`bundle.fileAssociations`), which
 * a gate keeps byte-identical to what the manifests say. A dropped-in / marketplace
 * plugin may declare associations too, but they are inert: the shell it would have to
 * amend was already signed and installed. That asymmetry is inherent to how every OS
 * registers handlers, so the field is honest about it rather than pretending.
 *
 * A declaration is an OPENING CLAIM, not a runtime guarantee: if the user disables
 * the plugin, the OS still routes the double-click to Localix and the file degrades
 * to whatever core can show (the plain editor) — exactly as if no plugin existed.
 *
 * Field names/values mirror Tauri's `FileAssociation` 1:1 (`ext`, `name`,
 * `description`, `mimeType`, `role`, `rank`) so aggregation stays a copy, never a
 * translation that could drift from the bundler's contract.
 */

/** `CFBundleTypeRole` (macOS): what the app does with the type. */
export const MINI_APP_FILE_ASSOCIATION_ROLES = ['Editor', 'Viewer', 'Shell', 'None'] as const
export type MiniAppFileAssociationRole = (typeof MINI_APP_FILE_ASSOCIATION_ROLES)[number]

/**
 * `LSHandlerRank` (macOS): how hard the app competes to be THE handler.
 * `Owner` = we created the format, `Default` = a first-class opener, `Alternate` =
 * a secondary viewer that should not displace the user's current default, `None` =
 * never auto-selected but drops are accepted.
 */
export const MINI_APP_FILE_ASSOCIATION_RANKS = ['Owner', 'Default', 'Alternate', 'None'] as const
export type MiniAppFileAssociationRank = (typeof MINI_APP_FILE_ASSOCIATION_RANKS)[number]

/**
 * Extensions are stored WITHOUT the leading dot and lower-cased (`"pdf"`, not
 * `".PDF"`) — `normalizeFileAssociationExt` does that for authored input. The regex
 * is deliberately narrow: an extension reaches an installer template and a plist,
 * so anything with a path separator, space, or wildcard is a packaging bug.
 */
export const MINI_APP_FILE_ASSOCIATION_EXT_RE = /^[a-z0-9][a-z0-9+._-]*$/

/** Lower-case an authored extension and drop a leading dot, as Tauri's parser does. */
export function normalizeFileAssociationExt(ext: string): string {
  const trimmed = ext.trim().toLowerCase()
  return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed
}

/**
 * One `plugin.json.fileAssociations` entry. `name` is required (unlike Tauri, which
 * falls back to `ext[0]`) because it is what Finder/Explorer show the user as the
 * file's KIND — an aggregated bundle where one family renders as "db" and another as
 * "PDF Document" reads as a bug, so the manifest makes the label a decision rather
 * than a default.
 */
export const miniAppFileAssociationSchema = z.object({
  /** Extensions this entry claims, dot-less and lower-cased after parsing. */
  ext: z
    .array(
      z
        .string()
        .min(1)
        .transform(normalizeFileAssociationExt)
        .refine(
          (ext) => MINI_APP_FILE_ASSOCIATION_EXT_RE.test(ext),
          'A file extension must be alphanumeric (dots, dashes, underscores and + allowed).',
        ),
    )
    .min(1),
  /** Human-readable kind shown by the OS file manager (`CFBundleTypeName`). */
  name: z.string().min(1),
  /** Longer blurb; Windows Explorer's `Type` column. */
  description: z.string().optional(),
  /** MIME type — Linux `.desktop` `MimeType=`, macOS `UTTypeTagSpecification`. */
  mimeType: z.string().optional(),
  role: z.enum(MINI_APP_FILE_ASSOCIATION_ROLES).optional(),
  rank: z.enum(MINI_APP_FILE_ASSOCIATION_RANKS).optional(),
})
/** Author-written association entry, before normalization. */
export type MiniAppFileAssociationInput = z.input<typeof miniAppFileAssociationSchema>
/** Normalized association entry (dot-less, lower-cased extensions). */
export type MiniAppFileAssociation = z.output<typeof miniAppFileAssociationSchema>

/**
 * Host-independent fields every Localix plugin manifest starts with. The API host
 * extends this schema with the contribution kinds it implements; keeping these
 * fields here prevents authoring tools and the host from silently disagreeing on
 * plugin identity, API compatibility, surface declarations, or config options.
 *
 * `surfaces` stays optional and unnormalized here. Parsing preserves the manifest
 * as authored; consumers call {@link normalizeMiniAppSurfaces} when they need the
 * legacy `['agent']` default and canonical values.
 */
export const miniAppManifestCoreSchema = z.object({
  name: z
    .string()
    .regex(PLUGIN_NAME_RE, 'Plugin name must be letters, numbers, dashes or underscores.'),
  version: z.string().default('0.0.0'),
  apiVersion: z.number().int().positive().optional(),
  /**
   * Authoring scaffolds may live beside first-party plugins without becoming a
   * distributable plugin. Generic discovery and packaging inspect this flag;
   * no host-owned list of concrete plugin names is required.
   */
  private: z.boolean().optional(),
  category: z.enum(MINI_APP_CATEGORIES).optional(),
  surfaces: z.array(z.string()).optional(),
  config: z.record(z.string(), miniAppConfigOptionSchema).optional(),
  /**
   * File families this plugin can open, projected onto the OS's handler registry at
   * PACKAGE time. See {@link miniAppFileAssociationSchema} — bundled plugins only.
   */
  fileAssociations: z.array(miniAppFileAssociationSchema).optional(),
})
/** Author-written core manifest shape before schema defaults are applied. */
export type MiniAppManifestCoreInput = z.input<typeof miniAppManifestCoreSchema>
/** Normalized core manifest after parsing. */
export type MiniAppManifestCore = z.output<typeof miniAppManifestCoreSchema>

export { humanizeMiniAppId, miniAppLabel } from './label'
