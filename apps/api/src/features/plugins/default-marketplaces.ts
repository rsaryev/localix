import { readJsonFile } from '../../lib/json'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SOURCES, type DefaultSource } from '@localixai/store'

import { envFlag } from '../../lib/env'
import { errorMessage } from '../../lib/errors'
import { isRecord } from '../../lib/record'
import { readKnownMarketplaces, writeKnownMarketplaces } from './marketplace-catalog'
import { withMarketplaceMutationLock } from './marketplace-lock'
import { describeMarketplaceSource, sameMarketplaceSource } from './marketplace-source-identity'
import type { MarketplaceSource } from './marketplace-source'

/**
 * THE DEFAULT MARKETPLACES (`docs/internals/store-scale.md`, "Default sources"): the Store's
 * default plugin sources — Localix's own `localix`, Anthropic's official and community
 * marketplaces — registered on start for browsing, the way Claude Code adds
 * `claude-plugins-official` the first time it starts. Nothing from them is installed or enabled.
 *
 * Idempotent: one registered already, under its name or any other from the same repository (the
 * person added it, or their Claude Code settings declare it), is reused. Remembered: once the
 * person removes one, it is not added back until they add it themselves (`.defaults.json` in the
 * marketplaces root). Offline: with
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` nothing is fetched, and a fetch that fails is tried
 * again at the next start rather than remembered.
 */
export type DefaultMarketplaceOutcome =
  | { status: 'registered' }
  | { status: 'present' }
  | { status: 'moved'; from: string }
  | { status: 'declined' }
  | { status: 'skipped'; reason: string }

export interface DefaultMarketplace {
  id: string
  source: MarketplaceSource
  entry: DefaultSource
}

const githubSource = (entry: DefaultSource): MarketplaceSource => ({
  source: 'github',
  repo: entry.input,
  ...(entry.paths ? { sparsePaths: [...entry.paths] } : {}),
})

export const DEFAULT_MARKETPLACES: readonly DefaultMarketplace[] = DEFAULT_SOURCES.filter(
  (entry) => entry.kind === 'plugin',
).map((entry) => ({ id: entry.id, source: githubSource(entry), entry }))

/** The default a registered marketplace is, by its name or the repository it came from. */
export function defaultMarketplaceOf(
  name: string,
  source: MarketplaceSource | undefined,
): DefaultMarketplace | undefined {
  return DEFAULT_MARKETPLACES.find(
    (found) => found.id === name || (source && sameMarketplaceSource(found.source, source)),
  )
}

/**
 * Where a default marketplace lived before. Up to v0.1.0-beta.17 `localix` was the core
 * repository's own catalog; its plugins have since moved to `LOCALIX_MARKETPLACE`'s repository,
 * and the core carries none. A profile from then keeps a `localix` record pointing at the core,
 * whose refresh finds no catalog, so every install fell back to the copy cloned back then and put
 * that release's plugins back. A record under the default's name that still points at a former
 * home is re-pointed at the current one; any other source under that name is the person's own and
 * is left alone.
 */
const FORMER_SOURCES: Readonly<Record<string, readonly MarketplaceSource[]>> = {
  localix: [{ source: 'github', repo: 'rsaryev/localix' }],
}

const movedFrom = (wanted: DefaultMarketplace, source: MarketplaceSource | undefined) =>
  source && FORMER_SOURCES[wanted.id]?.some((former) => sameMarketplaceSource(former, source))

/**
 * Point the record at the default's current source, keeping its folder and the person's
 * preferences; the fetch that follows replaces the folder. The record is moved first so a fetch
 * that fails now leaves the next refresh reading the new home, never the old one.
 */
async function followMove(root: string, wanted: DefaultMarketplace): Promise<string | null> {
  return withMarketplaceMutationLock(root, async () => {
    const known = await readKnownMarketplaces(root)
    const record = known[wanted.id]
    if (!record || !movedFrom(wanted, record.source)) return null
    known[wanted.id] = { ...record, source: wanted.source }
    await writeKnownMarketplaces(root, known)
    return describeMarketplaceSource(record.source)
  })
}

const STATE_FILE = '.defaults.json'

async function removedByPerson(root: string): Promise<Set<string>> {
  const state = await readJsonFile(join(root, STATE_FILE))
  const removed = new Set(
    isRecord(state) && Array.isArray(state.removed)
      ? state.removed.filter((id): id is string => typeof id === 'string')
      : [],
  )
  return removed
}

async function writeRemoved(root: string, removed: Set<string>) {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    join(root, STATE_FILE),
    JSON.stringify({ removed: [...removed].sort() }) + '\n',
  )
}

/** The person removed a default marketplace: do not add it back on a later start. */
export async function rememberDefaultMarketplaceRemoval(root: string, id: string): Promise<void> {
  const removed = await removedByPerson(root)
  removed.add(id)
  await writeRemoved(root, removed)
}

/** The person added it again themselves: the start-up registration may keep it from now on. */
export async function forgetDefaultMarketplaceRemoval(root: string, id: string): Promise<void> {
  const removed = await removedByPerson(root)
  removed.delete(id)
  await writeRemoved(root, removed)
}

export async function ensureDefaultMarketplaces(deps: {
  root: string
  add: (source: MarketplaceSource) => Promise<{ name: string; count: number }>
  env?: Record<string, string | undefined>
}): Promise<Record<string, DefaultMarketplaceOutcome>> {
  const out: Record<string, DefaultMarketplaceOutcome> = {}
  const offline = envFlag(
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    false,
    deps.env ?? process.env,
  )
  const removed = await removedByPerson(deps.root)
  for (const wanted of DEFAULT_MARKETPLACES) {
    const from = await followMove(deps.root, wanted)
    if (from) {
      // Offline, the record still moves; the next refresh or install fetches the new catalog.
      if (!offline) await deps.add(wanted.source).catch(() => {})
      out[wanted.id] = { status: 'moved', from }
      continue
    }
    const known = await readKnownMarketplaces(deps.root)
    const present =
      known[wanted.id] ||
      Object.values(known).some((record) => sameMarketplaceSource(record.source, wanted.source))
    if (present) out[wanted.id] = { status: 'present' }
    else if (removed.has(wanted.id)) out[wanted.id] = { status: 'declined' }
    else if (offline)
      out[wanted.id] = {
        status: 'skipped',
        reason: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set',
      }
    else
      try {
        await deps.add(wanted.source)
        out[wanted.id] = { status: 'registered' }
      } catch (error) {
        out[wanted.id] = { status: 'skipped', reason: errorMessage(error) }
      }
  }
  return out
}
