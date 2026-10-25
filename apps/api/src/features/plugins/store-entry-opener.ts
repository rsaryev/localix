import { NotFoundError } from '../../lib/domain-errors'
import type { MarketplaceEntry } from './marketplace'
import { resolveEntrySource } from './marketplace-entry-source'
import { parseMarketplaceRef } from './marketplace-source'
import { scanPluginContents, type PluginContents } from './store-contents'
import type { createContentsCache } from './store-contents-cache'
import type { MarketView } from './store-listing'
import type { readMarketViews } from './store-sources'

/**
 * How the plugin provider finds an entry and what it contains: from its marketplace's checkout, or
 * fetched once for a remote one (an opened page hears of the fetch through `changed`).
 */
export function createEntryOpener(deps: {
  views: () => ReturnType<typeof readMarketViews>
  cache: ReturnType<typeof createContentsCache>
  /** Fetch a remote entry into the plugin cache an install reuses; returns its folder. */
  fetchEntry: (ref: { plugin: string; marketplace: string }) => Promise<{ dir: string }>
  /** A checkout's folder was scanned (tests count them). */
  onScan?: () => void
  changed: () => void
}) {
  const { cache, changed } = deps
  /** What fetched remote entries contain, by id: learned once a page was opened. */
  const fetched = new Map<string, { dir: string; contents: PluginContents }>()

  async function find(id: string) {
    const ref = parseMarketplaceRef(id)
    const view = ref && (await deps.views()).views.find((found) => found.name === ref.marketplace)
    const entry = view?.market.plugins.find((found) => found.name === ref?.plugin)
    if (!ref || !view || !entry)
      throw new NotFoundError('store_listing_not_found', `No plugin "${id}" in the Store`)
    return { ref, view, entry }
  }

  /** The folder of an entry inside its marketplace's checkout, or null for a remote one. */
  function localDir(view: MarketView, entry: MarketplaceEntry): string | null {
    try {
      const at = resolveEntrySource(view.record.installLocation, entry, {
        pluginRoot: view.market.metadata?.pluginRoot,
      })
      return 'localPath' in at ? at.localPath : null
    } catch {
      return null
    }
  }

  async function localContents(view: MarketView, entry: MarketplaceEntry) {
    const dir = localDir(view, entry)
    if (!dir) return null
    const revision = view.record.gitCommitSha ?? view.record.lastUpdated ?? 'local'
    return cache.get(view.name, revision, entry.name, async () => {
      deps.onScan?.()
      return scanPluginContents(dir, `${entry.name}@${view.name}`, entry).catch(() => null)
    })
  }

  /** The folder and contents of an entry: its checkout's, or fetched once for a remote one. */
  const fetching = new Map<string, Promise<void>>()
  /** Fetch a remote entry once and read it; an opened page hears of it through `changed`. */
  function fetchRemote(
    id: string,
    ref: { plugin: string; marketplace: string },
    entry: MarketplaceEntry,
  ) {
    let run = fetching.get(id)
    if (!run) {
      run = (async () => {
        const { dir } = await deps.fetchEntry(ref)
        fetched.set(id, { dir, contents: await scanPluginContents(dir, id, entry) })
      })().finally(() => fetching.delete(id))
      fetching.set(id, run)
    }
    return run
  }

  /**
   * The folder and contents of an entry: its checkout's, or a remote one's once fetched. A page
   * does not `wait` for that fetch — it starts it and shows what the marketplace says; a plan does.
   */
  async function opened(id: string, wait = true) {
    const { ref, view, entry } = await find(id)
    const dir = localDir(view, entry)
    if (dir) return { view, entry, dir, contents: await localContents(view, entry) }
    if (!fetched.has(id)) {
      const run = fetchRemote(id, ref, entry)
      if (!wait) {
        run.then(changed, () => {})
        return { view, entry, dir: null, contents: null }
      }
      await run
    }
    return { view, entry, ...fetched.get(id)! }
  }

  return { fetched, fetching, find, localContents, opened }
}
