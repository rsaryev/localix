import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'
import type { StoreRecommendationEventsPort } from './service-types'

/**
 * WHAT HAPPENED TO RECOMMENDATIONS (`docs/internals/store.md`, "Recommendations"), kept on this
 * computer only: a package shown (in which place, found by which interest), opened, or installed
 * (and, when it was shown lately, what found it). Recommendations read it to rest a package shown
 * day after day and never opened, and to weigh what was installed lately above what was installed
 * long ago; the stats say which interests lead to installs. A log, not a record: what is older than
 * ninety days is pruned as new events come in.
 */

/** How long events are kept. */
const KEPT_MS = 90 * 24 * 60 * 60 * 1000

export function createRecommendationEventsRepository(
  db: Kysely<AppDatabase>,
): StoreRecommendationEventsPort {
  return {
    async record(userId, events, at) {
      if (events.length === 0) return
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto('store_recommendation_events')
          .values(
            events.map((event) => ({
              user_id: userId,
              kind: event.ref.kind,
              listing_id: event.ref.id,
              event: event.event,
              slot: event.slot,
              source: event.source ?? null,
              at,
            })),
          )
          .execute()
        await tx
          .deleteFrom('store_recommendation_events')
          .where('user_id', '=', userId)
          .where('at', '<', new Date(Date.parse(at) - KEPT_MS).toISOString())
          .execute()
      })
    },

    async installed(userId, ref, at, since) {
      // The latest showing says where it was and what found it; nothing shown, no interest counted.
      const shown = await db
        .selectFrom('store_recommendation_events')
        .select(['slot', 'source'])
        .where('user_id', '=', userId)
        .where('kind', '=', ref.kind)
        .where('listing_id', '=', ref.id)
        .where('event', '=', 'shown')
        .where('at', '>=', since)
        .orderBy('at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst()
      await db
        .insertInto('store_recommendation_events')
        .values({
          user_id: userId,
          kind: ref.kind,
          listing_id: ref.id,
          event: 'installed',
          slot: shown?.slot ?? null,
          source: shown?.source ?? null,
          at,
        })
        .execute()
    },

    async installedAt(userId, keys) {
      if (keys.length === 0) return new Map()
      const rows = await db
        .selectFrom('store_recommendation_events')
        .select(['kind', 'listing_id', sql<string>`max(at)`.as('at')])
        .where('user_id', '=', userId)
        .where('event', '=', 'installed')
        .where(sql<string>`kind || ':' || listing_id`, 'in', [...keys])
        .groupBy(['kind', 'listing_id'])
        .execute()
      return new Map(rows.map((row) => [`${row.kind}:${row.listing_id}`, row.at]))
    },

    async exposure(userId, since) {
      const rows = await db
        .selectFrom('store_recommendation_events')
        .select([
          'kind',
          'listing_id',
          sql<number>`count(distinct case when event = 'shown' then substr(at, 1, 10) end)`.as(
            'days',
          ),
          sql<number>`max(event = 'opened')`.as('opened'),
        ])
        .where('user_id', '=', userId)
        .where('at', '>=', since)
        .groupBy(['kind', 'listing_id'])
        .execute()
      return new Map(
        rows.map((row) => [
          `${row.kind}:${row.listing_id}`,
          { days: Number(row.days), opened: Number(row.opened) === 1 },
        ]),
      )
    },

    async stats(userId, since) {
      const rows = await db
        .selectFrom('store_recommendation_events')
        .select(['source', 'event', sql<number>`count(*)`.as('count')])
        .where('user_id', '=', userId)
        .where('at', '>=', since)
        .where('source', 'is not', null)
        .groupBy(['source', 'event'])
        .execute()
      const out: Record<string, { shown: number; opened: number; installed: number }> = {}
      for (const row of rows) {
        const counts = (out[row.source!] ??= { shown: 0, opened: 0, installed: 0 })
        counts[row.event] = Number(row.count)
      }
      return out
    },
  }
}
