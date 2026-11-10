import { z } from 'zod'
import { PLUGIN_ID_NAME_RE } from './contracts-base'
import { pluginConfigOptionSchema } from './contracts-config'

/**
 * What Localix keeps of a plugin's manifest: the metadata its screens and installs read, as
 * `kit/catalog/manifest.ts` maps Claude Code's `.claude-plugin/plugin.json` (`userConfig` →
 * `config`, `sensitive` → `secret`, …). Its components are the kit's (`DiscoveredPlugin.kit`).
 * Nothing here is a mini app's (rule X1): a plugin runs no Localix code.
 */
export const pluginManifestSchema = z.object({
  name: z
    .string()
    .regex(PLUGIN_ID_NAME_RE, 'Plugin name must be letters, numbers, dots, dashes or underscores.'),
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
   * Claude Code plugin-to-plugin dependencies: `["helper-lib", "name@market", { name, marketplace?, version? }]`.
   * `version` is a semver RANGE (checked advisorily — mismatch warns, never blocks).
   * Resolved on marketplace install (same marketplace first, then marketplaces the
   * parent catalog lists in `allowCrossMarketplaceDependenciesOn`, then already-
   * installed/bundled plugins by name) and cascaded on enable — see `dependencies.ts`.
   */
  dependencies: z
    .array(
      z.union([
        z.string(),
        z.object({
          name: z.string(),
          marketplace: z.string().optional(),
          version: z.string().optional(),
        }),
      ]),
    )
    .optional(),
})
export type PluginManifest = z.infer<typeof pluginManifestSchema>
