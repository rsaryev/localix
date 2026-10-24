import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SOURCES, type DefaultSource } from '@localixai/store'

import { envFlag } from '../../lib/env'
import { errorMessage } from '../../lib/errors'
import { isRecord } from '../../lib/record'
import { readKnownMarketplaces } from './marketplace-catalog'
import { sameMarketplaceSource } from './marketplace-source-identity'
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
 * marketplaces root; an earlier `.official.json` still counts for `localix`). Offline: with
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` nothing is fetched, and a fetch that fails is tried
 * again at the next start rather than remembered.
 */
export type DefaultMarketplaceOutcome =
  | { status: 'registered' }
  | { status: 'present' }
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

const STATE_FILE = '.defaults.json'
const LEGACY_STATE_FILE = '.official.json'

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function removedByPerson(root: string): Promise<Set<string>> {
  const state = await readJson(join(root, STATE_FILE))
  const removed = new Set(
    isRecord(state) && Array.isArray(state.removed)
      ? state.removed.filter((id): id is string => typeof id === 'string')
      : [],
  )
  const legacy = await readJson(join(root, LEGACY_STATE_FILE))
  if (isRecord(legacy) && legacy.removed === true) removed.add('localix')
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
  if (id === 'localix') await fs.rm(join(root, LEGACY_STATE_FILE), { force: true })
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
