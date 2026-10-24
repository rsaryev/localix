import type { Kysely } from 'kysely'
import type { Listing, ListingRef } from '@localixai/store'

import type { StoreIndexTables } from './index-repository-open'
import { fromRow, refKey } from './index-rows'

/**
 * Index rows into listings: the card, the person's state, and the other sources that list the
 * same origin ("Also in", each source once, the highest weight first).
 */
export function createAssemble(db: Kysely<StoreIndexTables>) {
  /** The other sources that list each origin, for "Also in". */
  async function alsoIn(rows: ReadonlyArray<{ origin: string | null; kind: string; id: string }>) {
    const origins = [...new Set(rows.flatMap((row) => (row.origin ? [row.origin] : [])))]
    const out = new Map<string, Array<{ id: string; label: string; key: string }>>()
    if (origins.length === 0) return out
    const others = await db
      .selectFrom('listing')
      .select(['origin', 'source_id', 'source_label', 'kind', 'id'])
      .where('origin', 'in', origins)
      .orderBy('weight', 'desc')
      .execute()
    for (const other of others) {
      const list = out.get(other.origin!) ?? []
      list.push({
        id: other.source_id,
        label: other.source_label,
        key: refKey(other as ListingRef),
      })
      out.set(other.origin!, list)
    }
    return out
  }

  async function assemble(
    rows: ReadonlyArray<{
      card: string
      state: string | null
      origin: string | null
      kind: string
      id: string
      source_id: string
    }>,
  ): Promise<Listing[]> {
    const copies = await alsoIn(rows)
    return rows.map((row) => {
      const own = refKey(row as ListingRef)
      const seen = new Set<string>([row.source_id])
      const others = (row.origin ? (copies.get(row.origin) ?? []) : [])
        .filter((copy) => copy.key !== own && !seen.has(copy.id) && seen.add(copy.id))
        .map(({ id, label }) => ({ id, label }))
      return fromRow({ card: row.card, state: row.state ?? null, alsoIn: others })
    })
  }

  return assemble
}
