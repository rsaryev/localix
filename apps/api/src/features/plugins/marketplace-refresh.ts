import { errorMessage } from '../../lib/errors'
import { readKnownMarketplaces } from './marketplace-catalog'
import {
  marketplacesRoot,
  parseMarketplaceRef,
  resolveMarketplaceInstall,
  updateMarketplace,
  type MarketplaceRegistryDeps,
  type ResolvedMarketplaceInstall,
} from './marketplace-registry'

/**
 * Claude Code reads the named marketplace again before a `name@marketplace` install, and before
 * `plugin update` re-installs from it (loading.md, "When Claude Code refreshes a marketplace before
 * an install"). A marketplace added from a local `file` or folder is read where it is, one
 * refreshed in the last 30 seconds is not fetched again, and
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns the refresh off. When the refresh fails the
 * install goes on from the cached catalog and says `marketplace not refreshed`.
 */

const RECENT_MS = 30_000
const refreshedAt = new Map<string, number>()

export interface RefreshOptions {
  /** Clock in milliseconds (tests). */
  now?: () => number
  env?: Record<string, string | undefined>
}

/** Refresh `marketplace` unless a rule above skips it; a failure is the returned note. */
export async function refreshMarketplace(
  marketplace: string,
  deps: MarketplaceRegistryDeps,
  opts: RefreshOptions & { includeLocal?: boolean; always?: boolean } = {},
): Promise<string | undefined> {
  const env = opts.env ?? process.env
  if (env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) return undefined
  const root = deps.root ?? marketplacesRoot()
  const known = (await readKnownMarketplaces(root))[marketplace]
  if (!known) return undefined
  const kind = known.source.source
  if ((kind === 'local' || kind === 'file') && !opts.includeLocal) return undefined
  const now = (opts.now ?? Date.now)()
  const key = `${root}\0${marketplace}`
  const last = refreshedAt.get(key)
  if (!opts.always && last !== undefined && now - last < RECENT_MS) return undefined
  try {
    await updateMarketplace(marketplace, deps)
    refreshedAt.set(key, now)
    return undefined
  } catch (error) {
    return `Marketplace "${marketplace}" was not refreshed (${errorMessage(error)}): installing from its cached catalog (marketplace not refreshed)`
  }
}

/** Resolve `plugin@marketplace` after reading that marketplace again. */
export async function resolveFreshMarketplaceInstall(
  ref: { plugin: string; marketplace: string },
  deps: MarketplaceRegistryDeps,
  opts: RefreshOptions & { notes: string[] },
): Promise<ResolvedMarketplaceInstall> {
  const note = await refreshMarketplace(ref.marketplace, deps, opts)
  if (note) opts.notes.push(note)
  return resolveMarketplaceInstall(ref, deps)
}

/**
 * Before `plugin update` re-installs `<plugin>@<marketplace>`, read its marketplace again —
 * a git, url or npm one as well as a local folder — so the update sees new commits, however
 * recently it was read: the 30-second rule is the install's. A failure keeps the cached catalog.
 */
export async function refreshMarketplaceBeforeUpdate(
  source: string,
  deps: MarketplaceRegistryDeps,
  opts: RefreshOptions = {},
): Promise<string | undefined> {
  const ref = parseMarketplaceRef(source)
  if (!ref) return undefined
  return refreshMarketplace(ref.marketplace, deps, { ...opts, includeLocal: true, always: true })
}
