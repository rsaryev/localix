import { sql, type ExpressionBuilder, type Kysely } from 'kysely'
import type { Listing, ListingRef } from '@localixai/store'

import { createAssemble } from './index-repository-assemble'
import { createIndexCards } from './index-repository-cards'
import { facetsOf } from './index-repository-facets'
import { narrowed, visibleListings, type IndexFilters } from './index-repository-filters'
import type { StoreIndexTables } from './index-repository-open'
import { refKey } from './index-rows'

/**
 * THE STORE INDEX'S READS: keyset pages ordered by score (lifted by the open project's words),
 * facet counts by `GROUP BY` over indexed columns, word candidates by FTS5 `MATCH` and `bm25`,
 * and the cards the Store's semantic collection embeds. Raw SQL only for `MATCH` and `bm25`.
 */

type Tables = StoreIndexTables & {
  l: StoreIndexTables['listing']
  s: StoreIndexTables['listing_state']
}
type Eb = ExpressionBuilder<Tables, 'l' | 's'>

/** Where a page ended: its last row's rank, name and ref. */
interface Cursor {
  r: number
  n: string
  k: string
  i: string
}
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url')
function decode(raw: string | undefined): Cursor | null {
  if (!raw) return null
  try {
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    return typeof cursor.r === 'number' && typeof cursor.i === 'string' ? cursor : null
  } catch {
    return null
  }
}

/**
 * A listing's rank on a page: its static score, lifted by a quarter for each of the open
 * project's words it is about (at most two count).
 */
/** How many of the open project's words a listing is about. */
function matchesOf(eb: Eb, boost: readonly string[]) {
  return boost
    .map((word) =>
      eb
        .case()
        .when(eb.fn<number>('instr', [eb.ref('l.signals'), eb.val(` ${word} `)]), '>', 0)
        .then(eb.val<number>(1))
        .else(eb.val<number>(0))
        .end(),
    )
    .reduce((sum, match) => eb(sum, '+', match))
}

function rankOf(eb: Eb, boost: readonly string[]) {
  if (boost.length === 0) return eb.ref('l.score')
  const lift = eb(
    eb.val<number>(0.25),
    '*',
    eb.fn<number>('min', [eb.val<number>(2), matchesOf(eb, boost)]),
  )
  return eb(eb.ref('l.score'), '*', eb(eb.val<number>(1), '+', lift))
}

/** Listings that say what they are for, read at most. */
const SUITED = 500

const ROW = [
  'l.card',
  's.state',
  'l.origin',
  'l.kind',
  'l.id',
  'l.display_name',
  'l.source_id',
] as const

export function createIndexReads(db: Kysely<StoreIndexTables>) {
  const assemble = createAssemble(db)

  return {
    /** One page in rank order, and where the next starts. */
    async page(
      userId: string,
      filters: IndexFilters,
      opts: {
        limit: number
        cursor?: string
        boost?: readonly string[]
        /** Only listings about at least one of the boost's words. */
        boosted?: boolean
      },
    ): Promise<{ listings: Listing[]; nextCursor?: string }> {
      const boost = opts.boost ?? []
      const after = decode(opts.cursor)
      let query = narrowed(visibleListings(db, userId), filters)
        .select(ROW)
        .select((eb) => rankOf(eb, boost).as('rank'))
      if (opts.boosted && boost.length > 0)
        query = query.where((eb) => eb(matchesOf(eb, boost), '>', 0))
      if (after)
        query = query.where((eb) => {
          const rank = rankOf(eb, boost)
          return eb.or([
            eb(rank, '<', after.r),
            eb.and([
              eb(rank, '=', after.r),
              eb.or([
                eb('l.display_name', '>', after.n),
                eb.and([
                  eb('l.display_name', '=', after.n),
                  eb.or([
                    eb('l.kind', '>', after.k),
                    eb.and([eb('l.kind', '=', after.k), eb('l.id', '>', after.i)]),
                  ]),
                ]),
              ]),
            ]),
          ])
        })
      const rows = await query
        .orderBy('rank', 'desc')
        .orderBy('l.display_name')
        .orderBy('l.kind')
        .orderBy('l.id')
        .limit(opts.limit + 1)
        .execute()
      const shown = rows.slice(0, opts.limit)
      const last = shown.at(-1)
      return {
        listings: await assemble(shown),
        ...(rows.length > opts.limit && last
          ? {
              nextCursor: encode({
                r: Number(last.rank),
                n: last.display_name,
                k: last.kind,
                i: last.id,
              }),
            }
          : {}),
      }
    },

    /** The newest versions first, of those the filters let through. */
    async newest(userId: string, filters: IndexFilters, limit: number): Promise<Listing[]> {
      const rows = await narrowed(visibleListings(db, userId), filters)
        .select(ROW)
        .where('l.updated_at', 'is not', null)
        .orderBy('l.updated_at', 'desc')
        .orderBy('l.score', 'desc')
        .limit(limit)
        .execute()
      return assemble(rows)
    },

    /** These listings as the person sees them, those the filters let through, by key. */
    async byRefs(
      userId: string,
      refs: readonly ListingRef[],
      filters: IndexFilters = {},
    ): Promise<Map<string, Listing>> {
      const out = new Map<string, Listing>()
      if (refs.length === 0) return out
      const ids = [...new Set(refs.map((ref) => ref.id))]
      const rows = await narrowed(visibleListings(db, userId), filters)
        .select(ROW)
        .where('l.id', 'in', ids)
        .execute()
      const wanted = new Set(refs.map(refKey))
      const kept = rows.filter((row) => wanted.has(refKey(row as ListingRef)))
      for (const listing of await assemble(kept)) out.set(refKey(listing.ref), listing)
      return out
    },

    /**
     * The listings their marketplace suggests for something (`Listing.suggestFor`) or that open a
     * kind of file (`Listing.opens`), none the person has installed, best score first: few, so read
     * whole and matched in memory (`recommend-rules.ts`).
     */
    async suited(userId: string, limit = SUITED): Promise<Listing[]> {
      const rows = await narrowed(visibleListings(db, userId), { installed: false })
        .select(ROW)
        .where((eb) =>
          eb.or([
            eb(sql<unknown>`json_extract(l.card, '$.suggestFor')`, 'is not', null),
            eb(sql<unknown>`json_extract(l.card, '$.opens')`, 'is not', null),
          ]),
        )
        .orderBy('l.score', 'desc')
        .limit(limit)
        .execute()
      return assemble(rows)
    },

    /** Word candidates: listings matching the FTS5 query, best `bm25` first. */
    async wordCandidates(
      userId: string,
      match: string,
      filters: IndexFilters,
      limit: number,
    ): Promise<Array<{ ref: ListingRef; text: string; static: number }>> {
      if (!match) return []
      const rows = await narrowed(
        visibleListings(db, userId).innerJoin(
          // Name and display name weigh most, then tags, then summary and components.
          sql<{
            pk: number
            rank: number
          }>`(SELECT rowid AS pk, bm25(listing_fts, 10.0, 10.0, 4.0, 2.0, 2.0) AS rank FROM listing_fts WHERE listing_fts MATCH ${match})`.as(
            'f',
          ),
          (join) => join.onRef('f.pk', '=', 'l.pk'),
        ),
        filters,
      )
        .select([
          'l.kind',
          'l.id',
          'l.score',
          'l.name',
          'l.display_name',
          'l.tags_text',
          'l.summary',
          'l.components_text',
        ])
        .orderBy(sql`f.rank`)
        .limit(limit)
        .execute()
      return rows.map((row) => ({
        ref: { kind: row.kind, id: row.id } as ListingRef,
        static: row.score,
        text: [row.display_name, row.name, row.tags_text, row.summary, row.components_text].join(
          ' ',
        ),
      }))
    },

    /** One listing as the person sees it, hidden duplicate or not. */
    async get(userId: string, ref: ListingRef): Promise<Listing | null> {
      const row = await db
        .selectFrom('listing as l')
        .leftJoin('listing_state as s', (join) =>
          join
            .onRef('s.kind', '=', 'l.kind')
            .onRef('s.id', '=', 'l.id')
            .on('s.user_id', '=', userId),
        )
        .select(ROW)
        .where('l.kind', '=', ref.kind)
        .where('l.id', '=', ref.id)
        .executeTakeFirst()
      return row ? ((await assemble([row]))[0] ?? null) : null
    },

    /** Every listing the person has state for: installed, or with a job. */
    async stated(userId: string): Promise<Listing[]> {
      const rows = await db
        .selectFrom('listing_state as s')
        .innerJoin('listing as l', (join) =>
          join.onRef('l.kind', '=', 's.kind').onRef('l.id', '=', 's.id'),
        )
        .select(ROW)
        .where('s.user_id', '=', userId)
        .orderBy('l.display_name')
        .execute()
      return assemble(rows)
    },

    facets: (userId: string, filters: IndexFilters) => facetsOf(db, userId, filters),

    ...createIndexCards(db),

    async count(): Promise<number> {
      const row = await db
        .selectFrom('listing')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst()
      return Number(row?.n ?? 0)
    },
  }
}
