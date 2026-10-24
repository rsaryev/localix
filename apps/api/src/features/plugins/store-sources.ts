import type { SourceView, StoreInstall, StoreProvider } from '@localixai/store'

import { errorMessage } from '../../lib/errors'
import { marketplaceAutoUpdate } from './marketplace-auto-update'
import {
  readKnownMarketplaces,
  readMarketplace,
  type KnownMarketplace,
} from './marketplace-catalog'
import { describeMarketplaceSource } from './marketplace-source-identity'
import type { PluginService } from './service-types'
import { marketView, type MarketView } from './store-listing'

/** A registered marketplace whose listing could not be read, and why. */
export interface BrokenMarket {
  name: string
  record: KnownMarketplace
  problem: string
}

/** Every registered marketplace: the ones read, and the ones that could not be. */
export async function readMarketViews(
  root: string,
): Promise<{ views: MarketView[]; broken: BrokenMarket[]; problems: string[] }> {
  const known = await readKnownMarketplaces(root)
  const views: MarketView[] = []
  const broken: BrokenMarket[] = []
  for (const [name, record] of Object.entries(known)) {
    try {
      views.push(marketView(name, record, await readMarketplace(record.installLocation)))
    } catch (error) {
      broken.push({
        name,
        record,
        problem: `The plugin marketplace "${name}" could not be read (${errorMessage(error)})`,
      })
    }
  }
  return { views, broken, problems: broken.map((market) => market.problem) }
}

/**
 * The registered marketplaces as the Store's sources: each removable, with its trust, when it was
 * last fetched and whether the background pass updates it; one that cannot be read says why.
 */
export function pluginStoreSources(
  views: readonly MarketView[],
  broken: readonly BrokenMarket[] = [],
): SourceView[] {
  const common = (name: string, record: KnownMarketplace) => ({
    kind: 'plugin' as const,
    id: name,
    url: describeMarketplaceSource(record.source),
    builtIn: false,
    autoUpdate: marketplaceAutoUpdate(name, record),
    ...(record.lastUpdated ? { syncedAt: record.lastUpdated } : {}),
  })
  return [
    ...views.map((view) => ({
      ...common(view.name, view.record),
      label: view.label,
      count: view.market.plugins.length,
      trust: view.trust,
    })),
    ...broken.map((market) => ({
      ...common(market.name, market.record),
      label: market.name,
      count: 0,
      problem: market.problem,
    })),
  ]
}

/**
 * The provider's methods over its marketplaces as sources: listed, read again or switched one at
 * a time, and the open project's own installs.
 */
export function pluginSourceMethods(deps: {
  service: Pick<PluginService, 'listPlugins' | 'updateMarketplace' | 'setMarketplaceAutoUpdate'>
  owner: string
  views: () => ReturnType<typeof readMarketViews>
  changed: () => void
}): Required<
  Pick<StoreProvider, 'sources' | 'refreshSource' | 'setSourceAutoUpdate' | 'projectInstalls'>
> {
  return {
    async sources() {
      const { views, broken } = await deps.views()
      return pluginStoreSources(views, broken)
    },

    async refreshSource(id) {
      await deps.service.updateMarketplace(deps.owner, { name: id })
      deps.changed()
    },

    async setSourceAutoUpdate(id, on) {
      await deps.service.setMarketplaceAutoUpdate(deps.owner, { name: id, autoUpdate: on })
      deps.changed()
    },

    async projectInstalls(actor) {
      const { plugins } = await deps.service.listPlugins(actor.userId, {
        projectId: actor.projectId,
      })
      const out = new Map<string, StoreInstall[]>()
      for (const record of plugins) {
        if (record.scope !== 'project' || record.projectId !== actor.projectId) continue
        const install: StoreInstall = {
          scope: 'project',
          ...(record.version ? { version: record.version } : {}),
          enabled: record.enabled,
        }
        out.set(record.source, [...(out.get(record.source) ?? []), install])
      }
      return [...out].map(([id, installs]) => ({ id, installs }))
    },
  }
}
