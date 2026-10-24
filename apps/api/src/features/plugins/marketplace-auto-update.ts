import { NotFoundError } from '../../lib/domain-errors'
import { envFlag } from '../../lib/env'
import {
  readKnownMarketplaces,
  writeKnownMarketplaces,
  type KnownMarketplace,
} from './marketplace-catalog'
import type { MarketplaceSource } from './marketplace-source'

/**
 * WHICH MARKETPLACES AUTO-UPDATE, by Claude Code's rule (loading.md, "Which marketplaces and plugins
 * auto-update"): the `autoUpdate` the person set on the record (the Marketplaces toggle writes it),
 * else the default — on for the official marketplace, off for every other one. Localix's official
 * marketplace is `localix`, registered from the GitHub repository `rsaryev/localix`; a marketplace
 * that takes the name from another source is a third-party one. Localix does not read
 * `extraKnownMarketplaces` from Claude Code's settings files, so the record is the only place the
 * choice lives.
 */
export const OFFICIAL_MARKETPLACE: { name: string; source: MarketplaceSource } = {
  name: 'localix',
  // Only the catalog and the plugins are checked out, not the rest of the repository.
  source: { source: 'github', repo: 'rsaryev/localix', sparsePaths: ['.claude-plugin', 'plugins'] },
}
// The Store's default sources (`@localixai/store`) name the same repository and folders.

const OFFICIAL_REPO = 'rsaryev/localix'

export function isOfficialMarketplace(name: string, record: Pick<KnownMarketplace, 'source'>) {
  if (name !== OFFICIAL_MARKETPLACE.name) return false
  const { source } = record
  if (source.source === 'github') return source.repo.toLowerCase() === OFFICIAL_REPO
  if (source.source === 'git')
    return /^https:\/\/github\.com\/rsaryev\/localix(?:\.git)?\/?$/i.test(source.url)
  return false
}

/** Whether the background pass refreshes this marketplace and updates its plugins. */
export function marketplaceAutoUpdate(
  name: string,
  record: Pick<KnownMarketplace, 'source' | 'autoUpdate'>,
): boolean {
  return record.autoUpdate ?? isOfficialMarketplace(name, record)
}

/**
 * "If you set `DISABLE_UPDATES=1`, `DISABLE_AUTOUPDATER=1`, or
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, the whole pass is off and the Enable auto-update
 * toggle is hidden, unless you also set `FORCE_AUTOUPDATE_PLUGINS=1`."
 */
export function autoUpdatePassAllowed(env: Record<string, string | undefined> = process.env) {
  if (envFlag('FORCE_AUTOUPDATE_PLUGINS', false, env)) return true
  return ![
    'DISABLE_UPDATES',
    'DISABLE_AUTOUPDATER',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  ].some((name) => envFlag(name, false, env))
}

/** The Marketplaces toggle: record the person's choice on the marketplace. */
export async function setMarketplaceAutoUpdate(
  root: string,
  name: string,
  autoUpdate: boolean,
): Promise<void> {
  const known = await readKnownMarketplaces(root)
  const record = known[name]
  if (!record) throw new NotFoundError('marketplace_not_found', `Unknown marketplace "${name}".`)
  known[name] = { ...record, autoUpdate }
  await writeKnownMarketplaces(root, known)
}
