import { sql, type Kysely } from 'kysely'
import type { ListingRef } from '@localixai/store'

import type { AppDatabase } from '../../db/types'
import type { StoreDismissalsPort } from './service-types'

/**
 * WHAT THE PERSON TURNED DOWN FOR RECOMMENDATIONS (`docs/internals/store.md`, "Recommendations"):
 * a package they are not interested in, or one they removed through the Store, is never
 * recommended to them again. It is their decision, not derived data, so it lives in the database
 * rather than the Store index a sync rebuilds. Search and the shelves still list it.
 */
export function createDismissalsRepository(
  db: Kysely<AppDatabase>,
  now: () => string = () => new Date().toISOString(),
): StoreDismissalsPort {
  return {
    async list(userId) {
      const rows = await db
        .selectFrom('store_recommendation_dismissals')
        .select(['kind', 'listing_id'])
        .where('user_id', '=', userId)
        .execute()
      // The same key `refKey` makes.
      return new Set(rows.map((row) => `${row.kind}:${row.listing_id}`))
    },

    async entries(userId) {
      const rows = await db
        .selectFrom('store_recommendation_dismissals')
        .select(['kind', 'listing_id', 'reason'])
        .where('user_id', '=', userId)
        .orderBy('dismissed_at', 'desc')
        .orderBy(sql`rowid`, 'desc')
        .execute()
      return rows.map((row) => ({
        ref: { kind: row.kind as ListingRef['kind'], id: row.listing_id },
        reason: row.reason,
      }))
    },

    async set(userId, ref, reason) {
      if (reason === null) {
        await db
          .deleteFrom('store_recommendation_dismissals')
          .where('user_id', '=', userId)
          .where('kind', '=', ref.kind)
          .where('listing_id', '=', ref.id)
          .execute()
        return
      }
      await db
        .insertInto('store_recommendation_dismissals')
        .values({
          user_id: userId,
          kind: ref.kind,
          listing_id: ref.id,
          reason,
          dismissed_at: now(),
        })
        // The first reason stands: saying "not interested" is not undone by a later removal.
        .onConflict((conflict) => conflict.columns(['user_id', 'kind', 'listing_id']).doNothing())
        .execute()
    },
  }
}
