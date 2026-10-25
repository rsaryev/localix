import { errorMessage } from '../../lib/errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { DiscoveredPlugin } from './discovery-types'
import { autoUpdatePassAllowed, marketplaceAutoUpdate } from './marketplace-auto-update'
import { readKnownMarketplaces } from './marketplace-catalog'
import { marketplacesRoot } from './marketplace-source'
import { sweepOrphanedVersions } from './plugin-cache'
import type { PluginUpdateJob, PluginUpdatesResponse } from './contracts-updates'
import {
  candidateFor,
  isNewer,
  listMarketplaceInstalls,
  marketplaceRecord,
  type MarketplaceInstall,
} from './update-candidates'

/**
 * PLUGIN UPDATES: what is available, the updates in flight, and the auto-update pass (Claude Code's
 * "Keep plugins updated"). Availability is computed from the marketplace listings without
 * installing (`update-candidates.ts`): on demand with a refresh of the listings, and by every pass.
 * An apply runs one job at a time through checking → downloading → installing → done or failed; a
 * failed update keeps the version before, because the install only swaps a record once the new
 * version is in place. Every move tells the subscribers (the Store's plugin provider); a finished
 * update is announced by the install itself, through the plugin change notices.
 *
 * In-memory status, like the mini app store's installs: it is rebuilt by the next check.
 */
export interface PluginUpdates {
  /** What the activity center reads. `refresh` fetches the listings again first. */
  status(userId: string, opts?: { refresh?: boolean }): Promise<PluginUpdatesResponse>
  /** The last computed status, without computing anything. */
  snapshot(): PluginUpdatesResponse
  /** Compute availability again from the listings on disk (after they were refreshed). */
  recheck(userId: string): Promise<void>
  /** Queue updates for these ids (all available when omitted); returns at once. */
  apply(userId: string, ids?: string[]): Promise<{ queued: string[] }>
  /** Resolves when every queued update has finished. */
  idle(): Promise<void>
  subscribe(listener: () => void): () => void
  /**
   * Refresh every marketplace with auto-update on and update the plugins installed from it, then
   * sweep orphaned versions. Off under the environment variables Claude Code honours.
   */
  autoUpdatePass(
    userId: string,
    opts?: { env?: Record<string, string | undefined> },
  ): Promise<{ skipped: boolean; refreshed: string[]; updated: string[]; failed: string[] }>
}

export function createPluginUpdates(deps: {
  repo: CapabilitySourceRepository
  home: string
  find: (userId: string, name: string) => Promise<DiscoveredPlugin | null>
  /** Re-install from `source`, replacing (the service's `install` with `replace: true`). */
  reinstall: (userId: string, source: string, onInstalling: () => void) => Promise<unknown>
  /** Refresh one marketplace's listing from its source. */
  refreshMarketplace: (name: string) => Promise<unknown>
  remoteCommit: (url: string, ref?: string) => Promise<string | undefined>
  /** Where the pass reads its switches when the caller names none. */
  env?: Record<string, string | undefined>
  now?: () => string
}): PluginUpdates {
  const now = deps.now ?? (() => new Date().toISOString())
  const root = marketplacesRoot(deps.home)
  let available: PluginUpdatesResponse['available'] = []
  let lastCheckedAt: string | null = null
  const jobs = new Map<string, PluginUpdateJob>()
  const listeners = new Set<() => void>()
  let queue: Promise<void> = Promise.resolve()

  const notify = () => {
    for (const listener of listeners) listener()
  }
  const setJob = (id: string, job: Omit<PluginUpdateJob, 'id'>) => {
    jobs.set(id, { id, ...job })
    notify()
  }
  const snapshot = (): PluginUpdatesResponse => ({
    available,
    jobs: [...jobs.values()],
    lastCheckedAt,
  })
  const installs = (userId: string) =>
    listMarketplaceInstalls({
      repo: deps.repo,
      userId,
      home: deps.home,
      find: (name) => deps.find(userId, name),
    })

  /** Refresh the listings of the marketplaces that installed something (or `only` these). */
  async function refreshListings(names: Iterable<string>): Promise<string[]> {
    const refreshed: string[] = []
    for (const name of new Set(names)) {
      try {
        await deps.refreshMarketplace(name)
        refreshed.push(name)
      } catch {
        // Offline or gone: the listing on disk stays what the check reads.
      }
    }
    return refreshed
  }

  async function check(userId: string, refresh: boolean): Promise<MarketplaceInstall[]> {
    const installed = await installs(userId)
    if (refresh) {
      const known = await readKnownMarketplaces(root)
      await refreshListings(
        installed.flatMap((install) => marketplaceRecord(known, install.marketplace)?.[0] ?? []),
      )
    }
    const known = await readKnownMarketplaces(root)
    const found: PluginUpdatesResponse['available'] = []
    for (const install of installed) {
      const candidate = await candidateFor(install, known, deps.remoteCommit).catch(() => null)
      if (!candidate || !isNewer(install, candidate)) continue
      const { id, name, marketplace, version: from } = install
      found.push({ id, name, marketplace, from, to: candidate.version })
    }
    available = found
    lastCheckedAt = now()
    notify()
    return installed
  }

  async function runJob(userId: string, id: string): Promise<boolean> {
    setJob(id, { phase: 'checking' })
    try {
      const install = (await installs(userId)).find((entry) => entry.id === id)
      if (!install) throw new Error(`"${id}" is not installed from a marketplace`)
      setJob(id, { phase: 'downloading' })
      await deps.reinstall(userId, install.source, () => setJob(id, { phase: 'installing' }))
      available = available.filter((entry) => entry.id !== id)
      setJob(id, { phase: 'done' })
      return true
    } catch (error) {
      setJob(id, { phase: 'failed', error: errorMessage(error) })
      return false
    }
  }

  function enqueue(userId: string, ids: string[]): Promise<string[]> {
    const done: string[] = []
    const run = queue.then(async () => {
      for (const id of ids) if (await runJob(userId, id)) done.push(id)
    })
    queue = run.catch(() => {})
    return run.then(() => done)
  }

  return {
    async status(userId, opts) {
      if (opts?.refresh || lastCheckedAt === null) await check(userId, opts?.refresh ?? false)
      return snapshot()
    },
    snapshot,
    async recheck(userId) {
      await check(userId, false)
    },
    async apply(userId, ids) {
      if (lastCheckedAt === null) await check(userId, false)
      const queued = ids ?? available.map((entry) => entry.id)
      void enqueue(userId, queued)
      return { queued }
    },
    idle: () => queue,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async autoUpdatePass(userId, opts) {
      if (!autoUpdatePassAllowed(opts?.env ?? deps.env ?? process.env))
        return { skipped: true, refreshed: [], updated: [], failed: [] }
      const known = await readKnownMarketplaces(root)
      const auto = Object.entries(known)
        .filter(([name, record]) => marketplaceAutoUpdate(name, record))
        .map(([name]) => name)
      const refreshed = await refreshListings(auto)
      await check(userId, false)
      const ids = available
        .filter((entry) => auto.includes(marketplaceRecord(known, entry.marketplace)?.[0] ?? ''))
        .map((entry) => entry.id)
      const updated = await enqueue(userId, ids)
      await sweepOrphanedVersions(deps.home).catch(() => [])
      return {
        skipped: false,
        refreshed,
        updated,
        failed: ids.filter((id) => !updated.includes(id)),
      }
    },
  }
}
