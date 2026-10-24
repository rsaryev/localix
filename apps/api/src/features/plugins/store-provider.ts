import type {
  InstallPlan,
  Listing,
  ListingDetail,
  Scope,
  StoreActor,
  StoreProvider,
} from '@localixai/store'
import { settingsEntityUiUri } from '@localixai/uri'

import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import type { PluginRecord } from './contracts'
import type { PluginUpdatesResponse } from './contracts-updates'
import { readKnownMarketplaces, readMarketplace } from './marketplace-catalog'
import type { MarketplaceEntry } from './marketplace'
import { resolveEntrySource } from './marketplace-entry-source'
import { parseMarketplaceRef } from './marketplace-source'
import type { PluginService } from './service-types'
import { readPluginReadme, scanPluginContents, type PluginContents } from './store-contents'
import { createContentsCache } from './store-contents-cache'
import { marketEditorial } from './store-editorial'
import { createPluginStoreJobs } from './store-jobs'
import { marketView, pluginListing, type MarketView } from './store-listing'
import { pluginStoreSources } from './store-sources'

/** What the provider asks of the plugin service. */
export type PluginStoreService = Pick<
  PluginService,
  | 'listPlugins'
  | 'install'
  | 'update'
  | 'remove'
  | 'setEnabled'
  | 'addMarketplace'
  | 'removeMarketplace'
  | 'refreshMarketplaces'
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
}): StoreProvider & { settled(): Promise<void> } {
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  const cache = createContentsCache(deps.cacheDir)
  /** What fetched remote entries contain, by id: learned once a page was opened. */
  const fetched = new Map<string, { dir: string; contents: PluginContents }>()
  const jobs = createPluginStoreJobs(changed)

  async function views(): Promise<{ views: MarketView[]; problems: string[] }> {
    const known = await readKnownMarketplaces(deps.root)
    const problems: string[] = []
    const out: MarketView[] = []
    for (const [name, record] of Object.entries(known)) {
      try {
        out.push(marketView(name, record, await readMarketplace(record.installLocation)))
      } catch (error) {
        problems.push(`The plugin marketplace "${name}" could not be read (${errorMessage(error)})`)
      }
    }
    return { views: out, problems }
  }

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
  async function opened(id: string) {
    const { ref, view, entry } = await find(id)
    const dir = localDir(view, entry)
    if (dir) return { view, entry, dir, contents: await localContents(view, entry) }
    let held = fetched.get(id)
    if (!held) {
      const { dir: into } = await deps.fetchEntry(ref)
      held = { dir: into, contents: await scanPluginContents(into, id, entry) }
      fetched.set(id, held)
    }
    return { view, entry, ...held }
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
  ): Pick<Listing, 'installs' | 'job' | 'configure'> {
    const offered = updates.available.find((found) => found.id === id)
    const job = jobs.of(id, updates)
    const first = records[0]
    return {
      installs: records.map((record) => ({
        scope: record.scope === 'project' ? 'project' : 'user',
        version: record.version,
        enabled: record.enabled,
        ...(offered && record.scope === 'global' ? { updateTo: offered.to } : {}),
      })),
      ...(job ? { job } : {}),
      ...(first
        ? { configure: settingsEntityUiUri('plugins', 'plugin', first.name, first.projectId) }
        : {}),
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
    settled: () => jobs.settled(),

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
      const { view, entry, dir, contents } = await opened(id)
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
        readme: await readPluginReadme(dir),
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

    async refresh() {
      await deps.service.refreshMarketplaces(deps.owner)
      changed()
    },

    sources: async () => pluginStoreSources((await views()).views),

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

    subscribe(onChange) {
      listeners.add(onChange)
      const stop = deps.service.updates.subscribe(onChange)
      return () => {
        listeners.delete(onChange)
        stop()
      }
    },
  }
}
