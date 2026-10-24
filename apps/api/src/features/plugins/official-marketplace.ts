import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { envFlag } from '../../lib/env'
import { errorMessage } from '../../lib/errors'
import { isRecord } from '../../lib/record'
import { OFFICIAL_MARKETPLACE } from './marketplace-auto-update'
import { readKnownMarketplaces } from './marketplace-catalog'
import type { MarketplaceSource } from './marketplace-source'

/**
 * THE OFFICIAL LOCALIX MARKETPLACE, registered on first start the way Claude Code adds
 * `claude-plugins-official` the first time you start an interactive session. It is not bundled:
 * it is the repository's own `.claude-plugin/marketplace.json`, fetched from GitHub
 * (`rsaryev/localix`), so plain Claude Code reads the same catalog with
 * `claude plugin marketplace add rsaryev/localix`.
 *
 * Idempotent: a registered `localix` is left alone. Remembered: once the person removes it, it is
 * not added back until they add it themselves (`.official.json` in the marketplaces root records
 * that). Offline: with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` nothing is fetched, and a fetch
 * that fails is tried again at the next start rather than remembered.
 */
export type OfficialMarketplaceOutcome =
  | { status: 'registered' }
  | { status: 'present' }
  | { status: 'declined' }
  | { status: 'skipped'; reason: string }

const STATE_FILE = '.official.json'
const stateFile = (root: string) => join(root, STATE_FILE)

async function removedByPerson(root: string): Promise<boolean> {
  try {
    const state = JSON.parse(await fs.readFile(stateFile(root), 'utf8')) as unknown
    return isRecord(state) && state.removed === true
  } catch {
    return false
  }
}

/** The person removed the official marketplace: do not add it back on a later start. */
export async function rememberOfficialMarketplaceRemoval(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(stateFile(root), JSON.stringify({ removed: true }) + '\n')
}

/** The person added it again themselves: the start-up registration may keep it from now on. */
export async function forgetOfficialMarketplaceRemoval(root: string): Promise<void> {
  await fs.rm(stateFile(root), { force: true })
}

export async function ensureOfficialMarketplace(deps: {
  root: string
  add: (source: MarketplaceSource) => Promise<{ name: string; count: number }>
  env?: Record<string, string | undefined>
}): Promise<OfficialMarketplaceOutcome> {
  if ((await readKnownMarketplaces(deps.root))[OFFICIAL_MARKETPLACE.name])
    return { status: 'present' }
  if (await removedByPerson(deps.root)) return { status: 'declined' }
  if (envFlag('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', false, deps.env ?? process.env))
    return { status: 'skipped', reason: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set' }
  try {
    await deps.add(OFFICIAL_MARKETPLACE.source)
    return { status: 'registered' }
  } catch (error) {
    return { status: 'skipped', reason: errorMessage(error) }
  }
}
