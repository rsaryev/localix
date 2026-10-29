import { z } from 'zod'

/**
 * mini-app.json manifest primitives — the common core schema, constants, and pure
 * helpers shared between the host's full zod schema (`apps/api` mini apps feature)
 * and external tooling (the template, the builder, marketplaces). The host
 * extends the core with the contributions it implements and re-exports these
 * primitives so there is exactly one statement of each cross-host rule.
 */

import { MINI_APP_NAME_RE, MINI_APP_CATEGORIES, MINI_APP_CONFIG_TYPES } from './primitives'

export {
  MINI_APP_NAME_RE,
  MINI_APP_QUALIFIED_NAME_RE,
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
 * One user-config option declared under `mini-app.json` `config`. Values are scalar.
 * `title`, `min`, and `max` are hints; a host may choose whether to render or enforce them.
 */
export const miniAppConfigOptionSchema = z.object({
  type: z.enum(MINI_APP_CONFIG_TYPES).default('string'),
  description: z.string().default(''),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  title: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})
/** Author-written shape before schema defaults are applied. */
export type MiniAppConfigOptionInput = z.input<typeof miniAppConfigOptionSchema>
/** Normalized config option after parsing. */
export type MiniAppConfigOption = z.output<typeof miniAppConfigOptionSchema>

/**
 * ── OS FILE ASSOCIATIONS ───────────────────────────────────────────────────────
 * A mini app that ships a dedicated viewer/editor for a file family declares that
 * family HERE, so the desktop bundle can tell the operating system "Localix opens
 * these". Runtime routing already lives beside the viewer (`host.fileEditors` /
 * `registerDedicatedViewerTypes`); this manifest field is the same knowledge
 * projected onto the ONE surface a runtime registry cannot reach — the app bundle's
 * `Info.plist` (macOS), NSIS/MSI registry writes (Windows) and `.desktop` `MimeType=`
 * (Linux), all of which are frozen at package time.
 *
 * The desktop packaging step aggregates every BUNDLED mini app's declarations into
 * `apps/desktop-tauri/src-tauri/tauri.conf.json` (`bundle.fileAssociations`), which
 * a gate keeps byte-identical to what the manifests say. A dropped-in / marketplace
 * mini app's associations never reach the OS: the shell it would have to amend was
 * already signed and installed. They reach the Store instead: packing copies them into
 * the catalog, and a file tab offers the app for a file of one of them that Localix
 * cannot show (`opensFile` in `@localixai/store`).
 *
 * A declaration is an OPENING CLAIM, not a runtime guarantee: if the user disables
 * the mini app, the OS still routes the double-click to Localix and the file degrades
 * to whatever core can show (the plain editor) — exactly as if no mini app existed.
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
 * One `mini-app.json` `fileAssociations` entry. `name` is required (unlike Tauri, which
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
 * Host-independent fields every Localix mini app manifest starts with. The API host
 * extends this schema with the contribution kinds it implements; keeping these
 * fields here prevents authoring tools and the host from silently disagreeing on
 * mini app identity, API compatibility, surface declarations, or config options.
 *
 * `surfaces` stays optional and unnormalized here. Parsing preserves the manifest
 * as authored; consumers call {@link normalizeMiniAppSurfaces} when they need the
 * `['agent']` default and canonical values.
 */
export const miniAppManifestCoreSchema = z.object({
  name: z
    .string()
    .regex(MINI_APP_NAME_RE, 'Mini app name must be letters, numbers, dashes or underscores.'),
  version: z.string().default('0.0.0'),
  apiVersion: z.number().int().positive().optional(),
  /**
   * Authoring scaffolds may live beside first-party mini apps without becoming a
   * distributable mini app. Generic discovery and packaging inspect this flag;
   * no host-owned list of concrete mini app names is required.
   */
  private: z.boolean().optional(),
  category: z.enum(MINI_APP_CATEGORIES).optional(),
  surfaces: z.array(z.string()).optional(),
  config: z.record(z.string(), miniAppConfigOptionSchema).optional(),
  /**
   * File families this mini app can open, projected onto the OS's handler registry at
   * PACKAGE time. See {@link miniAppFileAssociationSchema} — bundled mini apps only.
   */
  fileAssociations: z.array(miniAppFileAssociationSchema).optional(),
})
/** Author-written core manifest shape before schema defaults are applied. */
export type MiniAppManifestCoreInput = z.input<typeof miniAppManifestCoreSchema>
/** Normalized core manifest after parsing. */
export type MiniAppManifestCore = z.output<typeof miniAppManifestCoreSchema>

export { humanizeMiniAppId, miniAppLabel } from './label'
