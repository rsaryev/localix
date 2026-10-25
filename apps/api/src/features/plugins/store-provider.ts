import {
  createChangeSignal,
  listingConfigFromFields,
  scalarConfigValues,
  type InstallPlan,
  type Listing,
  type ListingDetail,
  type Scope,
  type StoreActor,
  type StoreProvider,
  type InstallableProvider,
} from '@localixai/store'

import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import type { PluginRecord } from './contracts'
import type { PluginUpdatesResponse } from './contracts-updates'
import type { MarketplaceEntry } from './marketplace'
import { resolveEntrySource } from './marketplace-entry-source'
import { parseMarketplaceRef } from './marketplace-source'
import type { PluginService } from './service-types'
import { readPluginReadme, scanPluginContents, type PluginContents } from './store-contents'
import { createContentsCache } from './store-contents-cache'
import { marketEditorial } from './store-editorial'
import { createPluginStoreJobs } from './store-jobs'
import { pluginListing, type MarketView } from './store-listing'
import { pluginSourceMethods, readMarketViews } from './store-sources'

/** What the provider asks of the plugin service. */
export type PluginStoreService = Pick<
  PluginService,
  | 'listPlugins'
  | 'install'
  | 'update'
  | 'remove'
  | 'setEnabled'
  | 'setConfig'
  | 'addMarketplace'
  | 'removeMarketplace'
  | 'refreshMarketplaces'
  | 'updateMarketplace'
  | 'setMarketplaceAutoUpdate'
> & { updates: Pick<PluginService['updates'], 'snapshot' | 'subscribe'> }

/**
 * PLUGINS AS A STORE PROVIDER (`docs/internals/store.md`, `store-scale.md`): every entry of every
 * registered marketplace is a listing, with the trust of its marketplace. What an entry inside the
 * marketplace's checkout contains is read from its folder (kept per checkout revision); a remote
 * one says `unknown` until its page is opened, which fetches it the way an install does
 * (`fetchEntry`) and reads it. Installs, updates, removals, the switch and the marketplaces
 * themselves go through the plugin service; `user` is a global install, `project` the open
 * project's.
 */
export function createPluginStoreProvider(deps: {
  /** The marketplaces root (`known.json` and the checkouts). */
  root: string
  /** Where what checkouts contain is kept between starts. */
  cacheDir: string
  /** Whose marketplaces they are: the workspace owner. */
  owner: string
  service: PluginStoreService
  /** Fetch a remote entry into the plugin cache an install reuses; returns its folder. */
  fetchEntry: (ref: { plugin: string; marketplace: string }) => Promise<{ dir: string }>
  /** Read a marketplace before it is added (`/plugin marketplace add` without keeping it). */
  previewMarketplace?: StoreProvider['previewSource']
  /** A checkout's folder was scanned (tests count them). */
  onScan?: () => void
}): InstallableProvider & { settled(): Promise<void> } {
  const { changed, subscribe } = createChangeSignal((listener) =>
    deps.service.updates.subscribe(listener),
  )
  const cache = createContentsCache(deps.cacheDir)
  /** What fetched remote entries contain, by id: learned once a page was opened. */
  const fetched = new Map<string, { dir: string; contents: PluginContents }>()
  const jobs = createPluginStoreJobs(changed)

  const views = () => readMarketViews(deps.root)

  async function find(id: string) {
    const ref = parseMarketplaceRef(id)
    const view = ref && (await views()).views.find((found) => found.name === ref.marketplace)
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

  async function installsBy(actor: StoreActor) {
    const { plugins } = await deps.service.listPlugins(actor.userId, {
      projectId: actor.projectId ?? null,
    })
    const out = new Map<string, PluginRecord[]>()
    for (const plugin of plugins)
      out.set(plugin.source, [...(out.get(plugin.source) ?? []), plugin])
    return out
  }

  function stateOf(
    id: string,
    records: PluginRecord[],
    updates: PluginUpdatesResponse,
  ): Pick<Listing, 'installs' | 'job' | 'configurable'> {
    const offered = updates.available.find((found) => found.id === id)
    const job = jobs.of(id, updates)
    return {
      installs: records.map((record) => ({
        scope: record.scope === 'project' ? 'project' : 'user',
        version: record.version,
        enabled: record.enabled,
        ...(offered && record.scope === 'global' ? { updateTo: offered.to } : {}),
      })),
      ...(job ? { job } : {}),
      ...(records.some((record) => record.config.length > 0) ? { configurable: true } : {}),
    }
  }

  const projectOf = (scope: Scope, actor: StoreActor): string | null => {
    if (scope === 'user') return null
    if (!actor.projectId)
      throw new InvalidRequestError(
        'plugin_store_no_project',
        'Open a project to install a plugin for it alone',
      )
    return actor.projectId
  }

  async function plan(id: string, scope: Scope, actor: StoreActor): Promise<InstallPlan> {
    projectOf(scope, actor)
    const { view, contents } = await opened(id)
    const runs = contents?.runs ?? []
    const warnings = [
      ...(view.trust === 'community'
        ? [`${view.label} is a community marketplace: Localix does not review what it lists`]
        : []),
      ...(runs.length ? ['It runs programs on this computer'] : []),
    ]
    return {
      scope,
      adds: contents?.components ?? [],
      runs,
      network: contents?.network ?? [],
      requires: [],
      warnings,
      needsConsent: view.trust === 'community' || runs.length > 0,
    }
  }

  return {
    kind: 'plugin',
    settled: async () => {
      await Promise.allSettled(fetching.values())
      await jobs.settled()
    },

    async listings(actor) {
      const [{ views: all, problems }, installs] = await Promise.all([views(), installsBy(actor)])
      const updates = deps.service.updates.snapshot()
      const listings: Listing[] = []
      for (const view of all) {
        for (const entry of view.market.plugins) {
          const id = `${entry.name}@${view.name}`
          const contents = (await localContents(view, entry)) ?? fetched.get(id)?.contents
          listings.push(
            pluginListing(view, entry, {
              ...(contents ? { contents } : {}),
              ...stateOf(id, installs.get(id) ?? [], updates),
            }),
          )
        }
        await cache.save(view.name).catch(() => {})
      }
      return { listings, problems }
    },

    async detail(id, actor): Promise<ListingDetail> {
      const { view, entry, dir, contents } = await opened(id, false)
      const installs = await installsBy(actor)
      const listing = pluginListing(view, entry, {
        ...(contents ? { contents } : {}),
        ...stateOf(id, installs.get(id) ?? [], deps.service.updates.snapshot()),
      })
      const facts: [string, string | undefined][] = [
        ['Version', entry.version],
        ['Author', listing.publisher.name],
        ['Category', entry.category],
        ['Homepage', entry.homepage],
        ['Marketplace', view.label],
      ]
      return {
        ...listing,
        readme: dir ? await readPluginReadme(dir) : null,
        media: [],
        facts: facts.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
        components: contents?.components ?? [],
      }
    },

    plan,

    async install(id, scope, consent, actor) {
      const projectId = projectOf(scope, actor)
      if ((await plan(id, scope, actor)).needsConsent && !consent.plan)
        throw new ConflictError(
          'plugin_store_consent',
          'Read what it runs, then say yes to install',
        )
      jobs.run(id, 'install', () =>
        deps.service.install(actor.userId, { source: id, projectId, enable: true }),
      )
    },

    async update(id, scope, actor) {
      const projectId = projectOf(scope, actor)
      const { entry } = await find(id)
      jobs.run(id, 'update', () =>
        deps.service.update(actor.userId, { name: entry.name, projectId }),
      )
    },

    async remove(id, scope, actor) {
      const { entry } = await find(id)
      await deps.service.remove(actor.userId, {
        name: entry.name,
        projectId: projectOf(scope, actor),
      })
      changed()
    },

    async setEnabled(id, scope, enabled, actor) {
      const { entry } = await find(id)
      await deps.service.setEnabled(actor.userId, {
        name: entry.name,
        projectId: projectOf(scope, actor),
        enabled,
      })
      changed()
    },

    /** The options its installs declare (`userConfig`), for the install in this scope. */
    async config(id, scope, actor) {
      const installs = (await installsBy(actor)).get(id) ?? []
      const scopeOf = (record: PluginRecord): Scope =>
        record.scope === 'project' ? 'project' : 'user'
      const record = installs.find((found) => scopeOf(found) === scope)
      if (!record || record.config.length === 0) return null
      return listingConfigFromFields(record.config, {
        scope,
        scopes: installs.filter((found) => found.config.length > 0).map(scopeOf),
      })
    },

    async setConfig(id, scope, values, actor) {
      const { entry } = await find(id)
      await deps.service.setConfig(actor.userId, {
        name: entry.name,
        projectId: projectOf(scope, actor),
        values: scalarConfigValues(values),
      })
      changed()
    },

    async refresh() {
      await deps.service.refreshMarketplaces(deps.owner)
      changed()
    },

    ...pluginSourceMethods({ service: deps.service, owner: deps.owner, views, changed }),

    /** What the editorial marketplaces pick for Discover (`store-editorial.ts`). */
    editorial: async () => (await views()).views.flatMap((view) => marketEditorial(view) ?? []),

    ...(deps.previewMarketplace ? { previewSource: deps.previewMarketplace } : {}),

    async addSource(input) {
      await deps.service.addMarketplace(deps.owner, { source: input })
      changed()
    },

    async removeSource(id) {
      await deps.service.removeMarketplace(deps.owner, { name: id })
      changed()
    },

    subscribe,
  }
}
