import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { findManifestPath } from './discovery'
import type { MarketplaceEntry } from './marketplace'
import { isRecord } from '../../lib/record'

/**
 * Marketplace entry → plugin manifest reconciliation (CC marketplace §1.3, strict mode).
 *
 * A marketplace ENTRY may carry component declarations inline (`skills`, `lspServers`,
 * and — passed through — `commands`/`agents`/`hooks`/`mcpServers`). Two cases:
 *
 *  - `strict:false` + NO plugin.json in the plugin dir → the entry IS the whole
 *    manifest (the `*-lsp` plugins ship only LICENSE+README; the `box` skill-bundle
 *    lists `skills` inline). We SYNTHESIZE a Claude-format plugin.json from the entry.
 *  - strict (default) + an existing plugin.json → the entry SUPPLEMENTS it. We
 *    additively merge the entry's component fields WITHOUT overwriting anything the
 *    real manifest already declares (`skills` union; `lspServers`/`mcpServers` add
 *    only new keys; scalar component fields fill only when absent).
 *
 * Pure `synthesize`/`merge` are unit-testable; {@link applyEntryManifestOverrides} is
 * the thin fs wrapper the installer calls on the freshly-copied plugin dir.
 */

/** The component + metadata fields an entry can contribute to a plugin manifest. */
const COMPONENT_FIELDS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
] as const

/** The inline component/metadata fields present on an entry (raw passthrough values). */
export function entryComponentOverrides(entry: MarketplaceEntry): Record<string, unknown> {
  const raw = entry as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const f of COMPONENT_FIELDS) if (raw[f] !== undefined) out[f] = raw[f]
  return out
}

/** True when the entry carries at least one inline component declaration. */
export function entryHasComponents(entry: MarketplaceEntry): boolean {
  return Object.keys(entryComponentOverrides(entry)).length > 0
}

/** Metadata fields an entry contributes to the manifest (CC marketplace §1.2). */
const METADATA_FIELDS = ['version', 'displayName', 'description'] as const

/** True when the entry carries anything (components OR metadata) worth reconciling. */
export function entryHasManifestOverrides(entry: MarketplaceEntry): boolean {
  const raw = entry as unknown as Record<string, unknown>
  return entryHasComponents(entry) || METADATA_FIELDS.some((f) => typeof raw[f] === 'string')
}

/**
 * Apply the entry's metadata to a manifest object IN PLACE, per the CC spec:
 * `version` on the entry OVERRIDES plugin.json's version; `displayName` and
 * `description` merely SUPPLEMENT — they fill in only when the manifest omits them.
 */
function applyMetadataOverrides(out: Record<string, unknown>, entry: MarketplaceEntry): void {
  const raw = entry as unknown as Record<string, unknown>
  if (typeof raw.version === 'string') out.version = raw.version
  for (const f of ['displayName', 'description'] as const) {
    if (out[f] === undefined && typeof raw[f] === 'string') out[f] = raw[f]
  }
}

/** Build a fresh manifest object from an entry that has no plugin.json (strict:false). */
export function synthesizeEntryManifest(entry: MarketplaceEntry): Record<string, unknown> {
  const raw = entry as unknown as Record<string, unknown>
  return {
    name: entry.name,
    ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
    ...(typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...entryComponentOverrides(entry),
  }
}

/**
 * Additively merge an entry's inline components into an EXISTING manifest object
 * (returns a new object). Never overwrites a value the manifest already declares:
 * `skills` arrays union; map fields (`lspServers`/`mcpServers`) add only new keys;
 * other component fields fill only when the manifest omits them.
 */
export function mergeEntryOverrides(
  manifest: Record<string, unknown>,
  entry: MarketplaceEntry,
): Record<string, unknown> {
  const overrides = entryComponentOverrides(entry)
  const out: Record<string, unknown> = { ...manifest }
  for (const [field, value] of Object.entries(overrides)) {
    const existing = out[field]
    if (existing === undefined) {
      out[field] = value
      continue
    }
    if (field === 'skills') {
      // Union the two path lists (either side may be a string or an array).
      const toArr = (v: unknown): string[] =>
        Array.isArray(v)
          ? v.filter((x): x is string => typeof x === 'string')
          : typeof v === 'string'
            ? [v]
            : []
      out[field] = [...new Set([...toArr(existing), ...toArr(value)])]
    } else if (isRecord(existing) && isRecord(value)) {
      // Map fields (lspServers/mcpServers): add only server ids the manifest lacks.
      out[field] = { ...value, ...existing }
    }
    // Otherwise keep the manifest's own value (it is the authority when strict).
  }
  applyMetadataOverrides(out, entry)
  return out
}

/**
 * Reconcile a freshly-installed plugin dir with its marketplace entry's inline
 * components. Writes a synthesized plugin.json when the dir has none, or additively
 * supplements an existing one (components + entry metadata: version overrides;
 * displayName/description fill gaps). No-op when the entry declares neither. The
 * A synthesized manifest is written to `<dir>/.claude-plugin/plugin.json`, preserving
 * the marketplace entry's Claude origin across discovery and restarts. Existing root
 * or nested manifests are updated in place.
 */
export async function applyEntryManifestOverrides(
  dir: string,
  entry: MarketplaceEntry,
): Promise<void> {
  if (!entryHasManifestOverrides(entry)) return
  const manifestPath = await findManifestPath(dir)
  if (!manifestPath) {
    // No plugin.json anywhere → the entry is the whole manifest (strict:false).
    const synthesizedPath = join(dir, '.claude-plugin', 'plugin.json')
    await fs.mkdir(join(dir, '.claude-plugin'), { recursive: true })
    await fs.writeFile(
      synthesizedPath,
      JSON.stringify(synthesizeEntryManifest(entry), null, 2) + '\n',
      'utf8',
    )
    return
  }
  let existing: Record<string, unknown>
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown
    if (!isRecord(parsed)) return // malformed manifest — leave it for the normal validator to report
    existing = parsed
  } catch {
    return
  }
  const merged = mergeEntryOverrides(existing, entry)
  await fs.writeFile(manifestPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}
