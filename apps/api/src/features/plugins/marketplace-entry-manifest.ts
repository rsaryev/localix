import { promises as fs } from 'node:fs'
import { join, posix } from 'node:path'

import { MANIFEST_DIR, MANIFEST_FILE } from '@localixai/claude-plugin'

import { findManifestPath } from './discovery'
import type { MarketplaceEntry } from './marketplace'
import { isRecord } from '../../lib/record'
import { rmrf } from '../ext/install-tree'

/**
 * Marketplace entry → plugin manifest reconciliation, as Claude Code combines an entry with
 * `plugin.json` (code.claude.com/docs/en/plugins/marketplace-reference#strict-mode):
 *
 *  - NO plugin.json → the entry IS the manifest, whatever `strict` says (the `*-lsp` plugins ship
 *    only LICENSE+README; skill bundles list `skills` inline). Every manifest field it carries
 *    applies; we SYNTHESIZE `.claude-plugin/plugin.json` from it. Entry `hooks` load only inline.
 *  - plugin.json + `strict` (default) → plugin.json is the authority; the entry's `commands`,
 *    `agents`, `skills`, `outputStyles` and `themes` are appended, its `hooks` replace the
 *    manifest's per event. Entry `mcpServers`, `lspServers`, `userConfig`, `channels` don't apply.
 *  - plugin.json + `strict: false` + entry components → a conflict; the plugin fails to load.
 *
 * Metadata, regardless of `strict`: the manifest's `version` wins; the entry's display fields and
 * `defaultEnabled` win. Pure `synthesize`/`merge` are unit-testable; {@link
 * applyEntryManifestOverrides} is the fs wrapper the installer calls on the staged copy.
 */

/** Component declarations an entry may carry inline. */
const COMPONENT_FIELDS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
  'outputStyles',
  'themes',
] as const
/** The components an entry may add to an existing plugin.json, or conflict with under strict:false. */
const COMBINED_FIELDS = ['commands', 'agents', 'skills', 'outputStyles', 'themes'] as const
/** Entry keys that describe the catalog listing, never the plugin. */
const ENTRY_ONLY = new Set([
  'source',
  'strict',
  'category',
  'tags',
  'relevance',
  'headers',
  'headersHelper',
])
/** Fields where the entry's value wins over plugin.json. */
const ENTRY_WINS = [
  'displayName',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'defaultEnabled',
] as const

const raw = (entry: MarketplaceEntry): Record<string, unknown> =>
  entry as unknown as Record<string, unknown>

/** The inline component fields present on an entry (raw passthrough values). */
export function entryComponentOverrides(entry: MarketplaceEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of COMPONENT_FIELDS) if (raw(entry)[f] !== undefined) out[f] = raw(entry)[f]
  return out
}

/** True when the entry carries at least one inline component declaration. */
export function entryHasComponents(entry: MarketplaceEntry): boolean {
  return Object.keys(entryComponentOverrides(entry)).length > 0
}

/** True when the entry carries anything (components OR metadata) worth reconciling. */
export function entryHasManifestOverrides(entry: MarketplaceEntry): boolean {
  return (
    entryHasComponents(entry) || ['version', ...ENTRY_WINS].some((f) => raw(entry)[f] !== undefined)
  )
}

const hooksError = (entry: MarketplaceEntry) =>
  new Error(
    `Plugin ${entry.name}: hooks as a file path or an array are not yet supported in a marketplace entry; write them as an inline object`,
  )

/** Build a fresh manifest object from an entry whose plugin has no plugin.json. */
export function synthesizeEntryManifest(entry: MarketplaceEntry): Record<string, unknown> {
  const hooks = raw(entry).hooks
  if (hooks !== undefined && !isRecord(hooks)) throw hooksError(entry)
  const out: Record<string, unknown> = { name: entry.name }
  for (const [field, value] of Object.entries(raw(entry))) {
    if (!ENTRY_ONLY.has(field) && value !== undefined) out[field] = value
  }
  return out
}

const toList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v])

/** Append the entry's paths to the manifest's (deduped); two object maps merge, manifest first. */
function appendComponent(existing: unknown, added: unknown): unknown {
  if (existing === undefined) return added
  if (isRecord(existing) && isRecord(added)) return { ...added, ...existing }
  if (isRecord(existing) || isRecord(added)) return existing
  return [...new Set([...toList(existing), ...toList(added)])]
}

/** The entry's inline hooks: its matchers for an event replace the manifest's for that event. */
function combineHooks(existing: unknown, added: Record<string, unknown>): unknown {
  if (existing === undefined) return added
  if (isRecord(existing)) return { ...existing, ...added }
  return [...toList(existing), added]
}

/** A `strict: false` entry that declares components conflicts with the plugin's plugin.json. */
function assertCombinable(entry: MarketplaceEntry): void {
  const declared = [...COMBINED_FIELDS, 'hooks'].filter((f) => raw(entry)[f] !== undefined)
  if (entry.strict === false && declared.length)
    throw new Error(
      `Plugin ${entry.name} has conflicting manifests: both plugin.json and marketplace entry specify components`,
    )
}

/**
 * Combine an entry with an EXISTING plugin.json object (returns a new object), per strict mode.
 * Throws the Claude Code conflict when a `strict: false` entry declares components.
 */
export function mergeEntryOverrides(
  manifest: Record<string, unknown>,
  entry: MarketplaceEntry,
): Record<string, unknown> {
  assertCombinable(entry)
  const out: Record<string, unknown> = { ...manifest }
  for (const field of COMBINED_FIELDS) {
    if (raw(entry)[field] !== undefined) out[field] = appendComponent(out[field], raw(entry)[field])
  }
  const hooks = raw(entry).hooks
  if (hooks !== undefined) {
    if (!isRecord(hooks)) throw hooksError(entry)
    out.hooks = combineHooks(out.hooks, hooks)
  }
  for (const field of ENTRY_WINS)
    if (raw(entry)[field] !== undefined) out[field] = raw(entry)[field]
  if (out.version === undefined && typeof raw(entry).version === 'string')
    out.version = raw(entry).version
  return out
}

/** True when the entry's source is the marketplace root itself (`.` or `./`). */
const sourceIsRoot = (entry: MarketplaceEntry): boolean =>
  typeof entry.source === 'string' && ['.', './', ''].includes(entry.source.trim())

const listedSkills = (entry: MarketplaceEntry): string[] =>
  toList(raw(entry).skills)
    .filter((p): p is string => typeof p === 'string')
    .map((p) => posix.normalize(p).replace(/\/+$/, ''))

/** A listed skill folder directly under `skills/`, which the default scan already reads. */
const underDefault = (path: string): boolean => /^skills\/[^/]+$/.test(path)

/**
 * An entry whose source is the marketplace root and that lists `skills` loads only those: the
 * default `skills/` folder of the staged copy keeps just the listed skill directories, and the
 * entry keeps listing only the ones outside it (the default scan reads the rest once).
 */
async function keepListedSkills(dir: string, entry: MarketplaceEntry): Promise<MarketplaceEntry> {
  if (!sourceIsRoot(entry) || raw(entry).skills === undefined) return entry
  const listed = listedSkills(entry)
  if (listed.some((p) => p === 'skills' || p === '.')) return entry
  const keep = new Set(listed.filter(underDefault).map((p) => p.split('/')[1] as string))
  const children = await fs.readdir(join(dir, 'skills')).catch(() => [] as string[])
  await Promise.all(
    children.filter((name) => !keep.has(name)).map((name) => rmrf(join(dir, 'skills', name))),
  )
  const outside = listed.filter((p) => !underDefault(p)).map((p) => `./${p}`)
  const { skills: _listed, ...rest } = raw(entry)
  return (outside.length ? { ...rest, skills: outside } : rest) as unknown as MarketplaceEntry
}

/** True when installing the entry trims its copy's skills, which a folder read in place cannot. */
export const entryPrunesSkills = (entry: MarketplaceEntry): boolean =>
  sourceIsRoot(entry) && raw(entry).skills !== undefined

/**
 * Reconcile a freshly-staged plugin copy with its marketplace entry: synthesize
 * `<dir>/.claude-plugin/plugin.json` when the plugin has no manifest, else combine the entry into
 * the existing one in place. No-op when the entry declares neither components nor metadata.
 */
export async function applyEntryManifestOverrides(
  dir: string,
  listing: MarketplaceEntry,
): Promise<void> {
  if (!entryHasManifestOverrides(listing)) return
  const entry = await keepListedSkills(dir, listing)
  const manifestPath = await findManifestPath(dir)
  if (!manifestPath) {
    const synthesized = synthesizeEntryManifest(entry)
    await fs.mkdir(join(dir, MANIFEST_DIR), { recursive: true })
    await fs.writeFile(join(dir, MANIFEST_FILE), JSON.stringify(synthesized, null, 2) + '\n')
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
  assertCombinable(listing)
  const merged = mergeEntryOverrides(existing, entry)
  await fs.writeFile(manifestPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}
