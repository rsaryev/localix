import { readCollections, readCuration, type Curation, type Editorial } from '@localixai/store'

import type { MarketplaceEntry } from './marketplace'
import type { MarketView } from './store-listing'

/**
 * A MARKETPLACE'S CURATION FOR THE STORE (`docs/extending/mini-app-marketplace.md`, "Curation"):
 * in `.claude-plugin/marketplace.json`, each plugin's `localix` key says whether it is featured,
 * installed by default and what it is suggested for, and `metadata.localix.collections` holds
 * Discover's rows. Both are fields Claude Code ignores at load time. Read for an editorial
 * marketplace only (`@localixai/store`'s default sources); any other curates nothing.
 */

/** An entry's curation, or none when its marketplace is not editorial. */
export function entryCuration(view: MarketView, entry: MarketplaceEntry): Curation {
  return view.editorial ? readCuration((entry as Record<string, unknown>).localix) : {}
}

export function marketEditorial(view: MarketView): Editorial | null {
  if (!view.editorial) return null
  const localix = (view.market.metadata as Record<string, unknown> | undefined)?.localix
  const collections = readCollections(
    (localix as Record<string, unknown> | undefined)?.collections,
    (name) => ({
      kind: 'plugin',
      id: `${name}@${view.name}`,
    }),
  )
  return collections.length ? { source: view.name, collections } : null
}
