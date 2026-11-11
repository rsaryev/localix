import { LOCALIX_MARKETPLACE } from '@localixai/store'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { isRecord } from '../../lib/record'
import { withMarketplaceMutationLock } from './marketplace-lock'
import {
  DEFAULT_MARKETPLACE_PATH,
  autoUpdatePassAllowed as kitPassAllowed,
  autoUpdateToggleRefusal,
  managedDeclarations,
  recordedAutoUpdate,
  type KnownMarketplace,
  type MarketplaceSource,
  readKnownMarketplaces,
  writeKnownMarketplaces,
} from './kit'

/**
 * WHICH MARKETPLACES AUTO-UPDATE, by Claude Code's rule as the kit judges it (loading.md, "Which
 * marketplaces and plugins auto-update"): the `autoUpdate` the person set on the record (the
 * Marketplaces toggle writes it), else the default — on for the official marketplaces, off for
 * every other one. Localix's official marketplace is `LOCALIX_MARKETPLACE` (`@localixai/store`),
 * registered from its GitHub repository; a marketplace that takes the name from another source is a
 * third-party one. A settings file's `autoUpdate` is copied onto the record when the declared
 * marketplace is added (`declared-marketplaces.ts`); a managed one also locks the toggle.
 */
export const OFFICIAL_MARKETPLACE: { name: string; source: MarketplaceSource } = {
  name: LOCALIX_MARKETPLACE.name,
  source: {
    kind: 'github',
    repo: LOCALIX_MARKETPLACE.repo,
    path: DEFAULT_MARKETPLACE_PATH,
    sparsePaths: [...LOCALIX_MARKETPLACE.paths],
  },
}

const OFFICIAL_REPO = LOCALIX_MARKETPLACE.repo.toLowerCase()

export function isOfficialMarketplace(name: string, record: Pick<KnownMarketplace, 'source'>) {
  if (name !== OFFICIAL_MARKETPLACE.name) return false
  const { source } = record
  if (source.kind === 'github') return source.repo.toLowerCase() === OFFICIAL_REPO
  if (source.kind === 'git') {
    const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(source.url)?.[1]
    return repo?.toLowerCase() === OFFICIAL_REPO
  }
  return false
}

/**
 * Whether the background pass refreshes this marketplace and updates its plugins: the kit's rule
 * (the record's choice, else on for Claude Code's official marketplaces), and on by default for
 * Localix's own official one as well.
 */
export function marketplaceAutoUpdate(
  name: string,
  record: Pick<KnownMarketplace, 'source' | 'autoUpdate'>,
): boolean {
  return (
    record.autoUpdate ??
    (isOfficialMarketplace(name, record) || recordedAutoUpdate(name, undefined))
  )
}

/**
 * "If you set `DISABLE_UPDATES=1`, `DISABLE_AUTOUPDATER=1`, or
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, the whole pass is off and the Enable auto-update
 * toggle is hidden, unless you also set `FORCE_AUTOUPDATE_PLUGINS=1`." Judged by the kit.
 */
export const autoUpdatePassAllowed = (env: Record<string, string | undefined> = process.env) =>
  kitPassAllowed(env)

/** The `autoUpdate` the organization's managed `extraKnownMarketplaces` entry sets, if any. */
async function managedAutoUpdate(name: string, managedSettingsDir: string | undefined) {
  const entry = (await managedDeclarations(managedSettingsDir))[name]
  return isRecord(entry) && typeof entry.autoUpdate === 'boolean' ? entry.autoUpdate : undefined
}

/**
 * The Marketplaces toggle: record the person's choice on the marketplace, unless the kit refuses
 * it — the whole pass is off, or managed settings set the marketplace's `autoUpdate`.
 */
export async function setMarketplaceAutoUpdate(
  root: string,
  name: string,
  autoUpdate: boolean,
  opts: { env: Record<string, string | undefined>; managedSettingsDir?: string | undefined },
): Promise<void> {
  const refusal = autoUpdateToggleRefusal({
    name,
    enable: autoUpdate,
    env: opts.env,
    managedAutoUpdate: await managedAutoUpdate(name, opts.managedSettingsDir),
  })
  if (refusal?.reason === 'paused')
    throw new ConflictError(
      'marketplace_auto_update_paused',
      'Auto-update is turned off for every marketplace by DISABLE_UPDATES, DISABLE_AUTOUPDATER or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.',
    )
  if (refusal) throw new ConflictError('marketplace_auto_update_managed', refusal.message)
  await withMarketplaceMutationLock(root, async () => {
    const known = await readKnownMarketplaces(root)
    const record = known[name]
    if (!record) throw new NotFoundError('marketplace_not_found', `Unknown marketplace "${name}".`)
    known[name] = { ...record, autoUpdate }
    await writeKnownMarketplaces(root, known)
  })
}
