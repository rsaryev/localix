import { z } from 'zod'

/**
 * plugin.json manifest primitives — the common core schema, constants, and pure
 * helpers shared between the host's full zod schema (`apps/api` plugins feature)
 * and external tooling (the template, plugin-builder, marketplaces). The host
 * extends the core with the contributions it implements and re-exports these
 * primitives so there is exactly one statement of each cross-host rule.
 */

export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

/**
 * A namespaced command/agent name: one or more {@link PLUGIN_NAME_RE} segments joined
 * by `:`. Nested Claude Code `commands/`/`agents/` subdirectories map their path into
 * this form — `commands/foo/bar.md` → `foo:bar` (full id `<plugin>:foo:bar`). A plain
 * (non-nested) name is the single-segment case, so this is a strict superset of
 * `PLUGIN_NAME_RE`.
 */
export const PLUGIN_QUALIFIED_NAME_RE = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*$/i

/**
 * The plugin API contract version this host implements (the `register(ctx)` shape,
 * hook signatures, command/arg/config schemas). A manifest may declare `apiVersion`;
 * a higher major than this means the plugin needs a newer host and is flagged in
 * validation. Bump on any breaking change to the plugin-facing contract.
 */
export const PLUGIN_API_VERSION = 1

/**
 * ── Plugin SURFACES ────────────────────────────────────────────────────────────
 * WHAT a plugin extends, declared by the plugin itself in `plugin.json`
 * (`"surfaces": ["agent", "workbench"]`):
 *
 *   - `agent`     — it gives the AGENT capability: tools, skills, slash commands,
 *                   MCP servers, sub-agents, prompt sections. The default.
 *   - `workbench` — it extends the IDE itself: rail sections, WorkItem tabs,
 *                   editors, panels, resource providers (Database/Docker/K8s/…).
 *
 * A plugin may declare BOTH. The host NEVER hardcodes which plugin is which —
 * every consumer reads the declaration. The field is a free-form string array on
 * purpose: an unknown surface is carried through untouched rather than rejected,
 * so a future host can give it meaning without a manifest migration.
 */
export const PLUGIN_SURFACE_AGENT = 'agent'
export const PLUGIN_SURFACE_WORKBENCH = 'workbench'

/** Broad launcher groups. A plugin declares one primary category; older manifests use Other. */
export const PLUGIN_CATEGORIES = ['development', 'data', 'content', 'utilities', 'games'] as const
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]

/**
 * Supported declarative config-option types. `directory` and `file` are path-valued
 * strings at runtime, while allowing hosts to offer a path-oriented editor.
 */
export const PLUGIN_CONFIG_TYPES = ['string', 'number', 'boolean', 'directory', 'file'] as const
export type PluginConfigType = (typeof PLUGIN_CONFIG_TYPES)[number]

/**
 * One user-config option declared under `plugin.json.config`. Values remain scalar
 * even when `multiple` is set: that Claude Code compatibility field is an authoring
 * hint, not an array storage mode. `title`, `min`, and `max` are hints too; a host may
 * choose whether to render or enforce them.
 */
export const pluginConfigOptionSchema = z.object({
  type: z.enum(PLUGIN_CONFIG_TYPES).default('string'),
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
export type PluginConfigOptionInput = z.input<typeof pluginConfigOptionSchema>
/** Normalized config option after parsing. */
export type PluginConfigOption = z.output<typeof pluginConfigOptionSchema>

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
export const PLUGIN_FILE_ASSOCIATION_ROLES = ['Editor', 'Viewer', 'Shell', 'None'] as const
export type PluginFileAssociationRole = (typeof PLUGIN_FILE_ASSOCIATION_ROLES)[number]

/**
 * `LSHandlerRank` (macOS): how hard the app competes to be THE handler.
 * `Owner` = we created the format, `Default` = a first-class opener, `Alternate` =
 * a secondary viewer that should not displace the user's current default, `None` =
 * never auto-selected but drops are accepted.
 */
export const PLUGIN_FILE_ASSOCIATION_RANKS = ['Owner', 'Default', 'Alternate', 'None'] as const
export type PluginFileAssociationRank = (typeof PLUGIN_FILE_ASSOCIATION_RANKS)[number]

/**
 * Extensions are stored WITHOUT the leading dot and lower-cased (`"pdf"`, not
 * `".PDF"`) — `normalizeFileAssociationExt` does that for authored input. The regex
 * is deliberately narrow: an extension reaches an installer template and a plist,
 * so anything with a path separator, space, or wildcard is a packaging bug.
 */
export const PLUGIN_FILE_ASSOCIATION_EXT_RE = /^[a-z0-9][a-z0-9+._-]*$/

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
export const pluginFileAssociationSchema = z.object({
  /** Extensions this entry claims, dot-less and lower-cased after parsing. */
  ext: z
    .array(
      z
        .string()
        .min(1)
        .transform(normalizeFileAssociationExt)
        .refine(
          (ext) => PLUGIN_FILE_ASSOCIATION_EXT_RE.test(ext),
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
  role: z.enum(PLUGIN_FILE_ASSOCIATION_ROLES).optional(),
  rank: z.enum(PLUGIN_FILE_ASSOCIATION_RANKS).optional(),
})
/** Author-written association entry, before normalization. */
export type PluginFileAssociationInput = z.input<typeof pluginFileAssociationSchema>
/** Normalized association entry (dot-less, lower-cased extensions). */
export type PluginFileAssociation = z.output<typeof pluginFileAssociationSchema>

/**
 * Host-independent fields every Localix plugin manifest starts with. The API host
 * extends this schema with the contribution kinds it implements; keeping these
 * fields here prevents authoring tools and the host from silently disagreeing on
 * plugin identity, API compatibility, surface declarations, or config options.
 *
 * `surfaces` stays optional and unnormalized here. Parsing preserves the manifest
 * as authored; consumers call {@link normalizePluginSurfaces} when they need the
 * legacy `['agent']` default and canonical values.
 */
export const pluginManifestCoreSchema = z.object({
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
  category: z.enum(PLUGIN_CATEGORIES).optional(),
  surfaces: z.array(z.string()).optional(),
  config: z.record(z.string(), pluginConfigOptionSchema).optional(),
  /**
   * File families this plugin can open, projected onto the OS's handler registry at
   * PACKAGE time. See {@link pluginFileAssociationSchema} — bundled plugins only.
   */
  fileAssociations: z.array(pluginFileAssociationSchema).optional(),
})
/** Author-written core manifest shape before schema defaults are applied. */
export type PluginManifestCoreInput = z.input<typeof pluginManifestCoreSchema>
/** Normalized core manifest after parsing. */
export type PluginManifestCore = z.output<typeof pluginManifestCoreSchema>

/**
 * Normalize a manifest's declared surfaces: trimmed, lower-cased, de-duped;
 * absent/empty → `['agent']` (the default surface, so every legacy manifest keeps
 * behaving as an agent plugin). Pure.
 */
export function normalizePluginSurfaces(declared?: readonly string[] | null): string[] {
  const seen = new Set<string>()
  for (const s of declared ?? []) {
    const v = s.trim().toLowerCase()
    if (v) seen.add(v)
  }
  return seen.size > 0 ? [...seen] : [PLUGIN_SURFACE_AGENT]
}

/**
 * Does a plugin extend the IDE workbench? The single predicate every UI grouping
 * uses — a plugin that declares the `workbench` surface belongs to the
 * workspace-tools bucket even when it also carries agent tools; everything else
 * is an agent plugin.
 */
export function isWorkbenchPlugin(surfaces?: readonly string[] | null): boolean {
  return normalizePluginSurfaces(surfaces).includes(PLUGIN_SURFACE_WORKBENCH)
}

export { humanizePluginId, pluginLabel } from './label'
