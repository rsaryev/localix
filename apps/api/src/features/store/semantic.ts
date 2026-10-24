import type { SemanticSource, SemanticSourceItem } from '@localixai/mini-app-sdk/backend'
import type { ListingRef } from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import { refKey, refOf } from './index-rows'
import { STORE_COLLECTION } from './search-provider'

/**
 * THE STORE'S LISTINGS IN THE SEMANTIC INDEX (`docs/internals/store-scale.md`, "Search"): their
 * own collection, so searching the Store never crowds the palette's search for an installed
 * skill, and the reverse. A list source over the Store index: each listing's name, summary, tags,
 * category and component names, scanned in index order. An unchanged listing costs a hash
 * compare in the indexer, so a sync re-embeds only what changed; until a listing is embedded it
 * is found by its words.
 */

type Card = Awaited<ReturnType<StoreIndexRepository['cards']>>[number]

export function createStoreSemanticSource(deps: {
  index: Pick<StoreIndexRepository, 'cards' | 'cardsByKey' | 'count'>
  /** Whose index it is: the workspace owner. */
  owner: string
}): SemanticSource {
  const item = (card: Card): SemanticSourceItem => ({
    key: refKey(card as ListingRef),
    userId: deps.owner,
    title: card.display_name,
    text: [card.summary, card.tags_text, card.category, card.components_text]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n'),
  })
  return {
    collection: STORE_COLLECTION,
    label: 'Store',
    version: 1,
    async scan(cursor, limit) {
      const cards = await deps.index.cards(cursor ? Number(cursor) : 0, limit)
      const last = cards.at(-1)
      return {
        items: cards.map(item),
        next: cards.length === limit && last ? String(last.pk) : null,
      }
    },
    async read(keys) {
      const refs = keys.flatMap((key) => refOf(key) ?? [])
      return (await deps.index.cardsByKey(refs)).map(item)
    },
    count: () => deps.index.count(),
  }
}
