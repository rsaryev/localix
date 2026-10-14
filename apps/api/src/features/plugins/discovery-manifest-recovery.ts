import { promises as fs } from 'node:fs'

import { summarizeZodIssues } from '@localixai/plugin-sdk/backend'

import { pluginManifestSchema, type PluginManifest } from './contracts'
import type { ZodError } from 'zod'

/**
 * CC-compatibility manifest fixups used by discovery's `loadManifest`, split out
 * because they are pure raw-JSON transforms with no filesystem or discovery state:
 *
 *  - {@link applyManifestPromotions} — promote CC field aliases on the raw object
 *    BEFORE zod parse (zod strips unknown keys, so aliases must be mapped first).
 *  - {@link tryRecoverManifest} — salvage a manifest whose only zod failures are in
 *    the `config` block (the #1 real CC break: `type: "directory" | "file"`).
 */

/**
 * Apply CC-compatibility field promotions to a raw (pre-zod) manifest object in place.
 * Must run before zod parse so the promoted fields are picked up by the schema.
 *
 * Promotions applied:
 * - `experimental.monitors` → top-level `monitors` (CC migration path)
 * - `panels` → `views` (the legacy inspector-panel array; `name` becomes the view `id`,
 *   and a view's `surface` — when a pre-unification manifest still declares one — is
 *   dropped, because every plugin view now opens as a work-item tab)
 * - `userConfig` → `config` (CC name for our `config` field)
 * - `sensitive: true` on any config option → `secret: true` (CC field name alias, B2 fix)
 *   Zod strips unknown fields, so `sensitive` must be mapped to `secret` HERE, before
 *   the schema parses — otherwise a CC-style secret leaks into model-facing prompt/skill
 *   text because `isSecret(key)` stays false.
 */
export function applyManifestPromotions(j: Record<string, unknown>): void {
  const exp = j.experimental
  // Only promote an ARRAY (the CC inline form). A non-array `experimental.monitors`
  // (e.g. a `monitors/monitors.json` path string) must NOT land in the array-typed
  // top-level `monitors` field — that would fail schema parse and break the load.
  if (!j.monitors && exp && typeof exp === 'object') {
    const em = (exp as Record<string, unknown>).monitors
    if (Array.isArray(em)) j.monitors = em
  }
  // Legacy `panels` fold into `views`: same sandboxed HTML, one contract. Appended
  // after any native `views` so an author migrating field-by-field keeps both, and the
  // now-meaningless `surface` key is stripped from either shape.
  const legacyPanels = j.panels
  if (Array.isArray(legacyPanels)) {
    const promoted = legacyPanels.flatMap((panel) => {
      if (!panel || typeof panel !== 'object' || Array.isArray(panel)) return []
      const { name, surface: _surface, ...rest } = panel as Record<string, unknown>
      return [{ ...rest, ...(typeof name === 'string' ? { id: name } : {}) }]
    })
    j.views = [...(Array.isArray(j.views) ? j.views : []), ...promoted]
    delete j.panels
  }
  if (Array.isArray(j.views)) {
    j.views = j.views.map((view) =>
      view && typeof view === 'object' && !Array.isArray(view)
        ? (({ surface: _surface, ...rest }) => rest)(view as Record<string, unknown>)
        : view,
    )
  }
  if (!j.config && j.userConfig && typeof j.userConfig === 'object') {
    j.config = j.userConfig
  }
  // Map CC `sensitive: true` → `secret: true` on each config option.
  // This must happen on the raw object (before Zod strips `sensitive` as unknown).
  // Works for both native `config` and promoted `userConfig`-as-`config`.
  const cfg = j.config
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    for (const opt of Object.values(cfg as Record<string, unknown>)) {
      if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
        const o = opt as Record<string, unknown>
        if (o['sensitive'] === true) {
          o['secret'] = true
        }
      }
    }
  }
}

/**
 * Attempt to recover a usable manifest from a failed `safeParse`.
 *
 * Recovery is permitted ONLY when every Zod issue originates inside the `config`
 * record (path starts with `['config', <key>]`). In that case we strip the
 * offending config keys and re-parse the cleaned object. This covers the #1 real
 * CC compatibility break: `type: "directory"` or `type: "file"` config options,
 * which previously made the whole manifest fail.
 *
 * If any issue touches fields outside `config` (e.g. missing name, bad MCP shape),
 * we return `{ manifest: null }` — the caller sets a fatal error as before.
 *
 * Boundary: we only strip at the granularity of a whole config key (not a sub-field
 * within it), so a config entry with multiple bad fields is fully removed, not
 * partially patched. The droppedKeys list is returned for the warning message.
 */
export function tryRecoverManifest(
  json: Record<string, unknown>,
  zodError: ZodError,
): { manifest: PluginManifest; droppedKeys: string[] } | { manifest: null; droppedKeys: [] } {
  const issues = zodError.issues
  // Collect the config keys that have issues; abort if ANY issue is outside config.
  const badConfigKeys = new Set<string>()
  for (const issue of issues) {
    const path = issue.path
    if (path.length >= 2 && path[0] === 'config' && typeof path[1] === 'string') {
      badConfigKeys.add(path[1])
    } else {
      // Issue outside the config block — cannot recover.
      return { manifest: null, droppedKeys: [] }
    }
  }
  if (badConfigKeys.size === 0) return { manifest: null, droppedKeys: [] }

  // Strip the offending config keys and retry.
  const cleaned = { ...json }
  if (cleaned.config && typeof cleaned.config === 'object' && !Array.isArray(cleaned.config)) {
    const cleanedConfig = { ...(cleaned.config as Record<string, unknown>) }
    for (const key of badConfigKeys) delete cleanedConfig[key]
    cleaned.config = cleanedConfig
  }
  const retry = pluginManifestSchema.safeParse(cleaned)
  if (!retry.success) return { manifest: null, droppedKeys: [] }
  return { manifest: retry.data, droppedKeys: [...badConfigKeys].sort() }
}

/** The result of reading+parsing a plugin's (optional) manifest file. */
export interface ParsedManifestFile {
  manifest: PluginManifest
  /** Raw object snapshot (pre-promotion) — undefined when no manifest file existed. */
  rawManifest?: Record<string, unknown>
  /** Non-fatal warning (partial recovery) or fatal read/schema error. */
  error?: string
  /** True when the manifest only loaded after stripping bad config keys. */
  manifestRecovered: boolean
}

/**
 * Read, CC-promote, validate and (if needed) recover a plugin's manifest file.
 * The manifest is OPTIONAL (CC parity): when `manifestPath` is null the directory
 * is a valid plugin named after `fallbackName` with default version/description.
 * Pure parse path — no discovery/precedence logic — so it lives beside the other
 * raw-manifest transforms and is unit-testable in isolation.
 */
export async function parseManifestFile(
  manifestPath: string | null,
  fallbackName: string,
): Promise<ParsedManifestFile> {
  const manifest: PluginManifest = { name: fallbackName, version: '0.0.0', description: '' }
  if (!manifestPath) return { manifest, manifestRecovered: false }

  let raw: string
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch (err) {
    return {
      manifest,
      manifestRecovered: false,
      error:
        err instanceof Error
          ? `Cannot read plugin.json: ${err.message}`
          : 'Cannot read plugin.json',
    }
  }

  let json: unknown
  try {
    json = JSON.parse(raw) as unknown
  } catch (err) {
    return {
      manifest,
      manifestRecovered: false,
      error:
        err instanceof Error
          ? `Invalid plugin.json: ${err.message}`
          : 'Invalid plugin.json: malformed JSON',
    }
  }

  try {
    let rawManifest: Record<string, unknown> | undefined
    if (json && typeof json === 'object') {
      rawManifest = { ...(json as Record<string, unknown>) } // snapshot before promotions
      applyManifestPromotions(json as Record<string, unknown>)
    }
    const parsed = pluginManifestSchema.safeParse(json)
    if (parsed.success) {
      return { manifest: parsed.data, rawManifest, manifestRecovered: false }
    }
    // Graceful degradation: attempt to recover a usable manifest by stripping
    // only the offending config entries and re-parsing, so a plugin with one
    // unsupported config-option type still loads its tools/MCP/hooks/commands.
    // Truly broken manifests (invalid JSON, missing name, schema errors outside
    // config) still fail hard.
    const recovered = tryRecoverManifest(json as Record<string, unknown>, parsed.error)
    if (recovered.manifest) {
      return {
        manifest: recovered.manifest,
        rawManifest,
        manifestRecovered: true,
        // Surface a non-fatal warning so the author sees what was dropped.
        error: `plugin.json partially loaded (${recovered.droppedKeys.map((k) => `config.${k}`).join(', ')} ignored — unsupported field values): fix the manifest to remove this warning`,
      }
    }
    return {
      manifest,
      rawManifest,
      manifestRecovered: false,
      error: `Invalid plugin.json: ${summarizeZodIssues(parsed.error).message}`,
    }
  } catch (err) {
    return {
      manifest,
      manifestRecovered: false,
      error: err instanceof Error ? `Invalid plugin.json: ${err.message}` : 'Invalid plugin.json',
    }
  }
}
