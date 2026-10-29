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

import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import type { PluginRecord } from './contracts'
import type { PluginUpdatesResponse } from './contracts-updates'
import { readPluginReadme } from './store-contents'
import { createContentsCache } from './store-contents-cache'
import { marketEditorial } from './store-editorial'
import { createPluginStoreJobs } from './store-jobs'
import { pluginListing } from './store-listing'
import { pluginSourceMethods, readMarketViews } from './store-sources'
import { createEntryOpener } from './store-entry-opener'

export type { PluginStoreService } from './store-provider-types'
import type { PluginStoreService } from './store-provider-types'

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
  const views = () => readMarketViews(deps.root)
  const jobs = createPluginStoreJobs(changed)
  const { fetched, fetching, find, localContents, opened } = createEntryOpener({
    views,
    cache,
    fetchEntry: deps.fetchEntry,
    ...(deps.onScan ? { onScan: deps.onScan } : {}),
    changed,
  })

  /** The installs a listing shows, by listing id (`name@marketplace`). */
  async function installsBy(actor: StoreActor) {
    const { plugins } = await deps.service.listPlugins(actor.userId, {
      projectId: actor.projectId ?? null,
    })
    const bySource = new Map<string, PluginRecord[]>()
    for (const plugin of plugins)
      bySource.set(plugin.source, [...(bySource.get(plugin.source) ?? []), plugin])
    return { get: (id: string): PluginRecord[] | undefined => bySource.get(id) }
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
    // What it runs is the plan's own `runs`, shown wherever the plan is: a warning saying it again
    // was the consent sheet's loudest line.
    const warnings =
      view.trust === 'community'
        ? [`${view.label} is a community marketplace: Localix does not review what it lists`]
        : []
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
