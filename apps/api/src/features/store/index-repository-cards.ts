import type { Kysely } from 'kysely'
import type { ListingRef } from '@localixai/store'

import type { StoreIndexTables } from './index-repository-open'
import { refKey } from './index-rows'

const CARD = [
  'pk',
  'kind',
  'id',
  'display_name',
  'summary',
  'tags_text',
  'category',
  'components_text',
] as const

/** The cards the Store's semantic collection embeds (`semantic.ts`), read in index order. */
export function createIndexCards(db: Kysely<StoreIndexTables>) {
  return {
    /** Cards in index order for the semantic collection: after `pk`, at most `limit`. */
    async cards(after: number, limit: number) {
      return db
        .selectFrom('listing')
        .select(CARD)
        .where('pk', '>', after)
        .orderBy('pk')
        .limit(limit)
        .execute()
    },

    async cardsByKey(refs: readonly ListingRef[]) {
      if (refs.length === 0) return []
      const rows = await db
        .selectFrom('listing')
        .select(CARD)
        .where('id', 'in', [...new Set(refs.map((ref) => ref.id))])
        .execute()
      const wanted = new Set(refs.map(refKey))
      return rows.filter((row) => wanted.has(refKey(row as ListingRef)))
    },
  }
}
