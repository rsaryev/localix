import type { SourceView } from '@localixai/store'

import { describeMarketplaceSource } from './marketplace-source-identity'
import type { MarketView } from './store-listing'

/** The registered marketplaces as the Store's sources: each removable, with its trust. */
export function pluginStoreSources(views: readonly MarketView[]): SourceView[] {
  return views.map((view) => ({
    kind: 'plugin',
    id: view.name,
    label: view.label,
    url: describeMarketplaceSource(view.record.source),
    builtIn: false,
    count: view.market.plugins.length,
    trust: view.trust,
  }))
}
