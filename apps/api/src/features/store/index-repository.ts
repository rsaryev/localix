import { cardOfRow } from './index-rows'
import type { Kysely } from 'kysely'
import type { ListingRef, StoreComponent } from '@localixai/store'

import type { StoreIndexTables } from './index-repository-open'
import { createIndexReads } from './index-repository-reads'
import type { IndexRow, ListingCard, StateRow } from './index-rows'

/**
 * THE STORE INDEX'S WRITES (`docs/internals/store-scale.md`, "Index storage"). A source's listings
 * are replaced in one transaction — delete by source, insert in batches — so a reader sees the
 * old set or the new one, never half; a person's state is replaced per provider. Components read
 * from a fetched package (`learned`) outlive a replace while the source still does not know them.
 */

const BATCH = 200

const listingColumns = (row: IndexRow & { learned?: boolean }) => {
  const { components: _components, learned: _learned, ...columns } = row
  return columns
}

/** A card whose source does not know what it contains, filled in from what was learned. */
export function learnedCard(card: ListingCard, parts: readonly StoreComponent[]): ListingCard {
  const contents: Partial<Record<StoreComponent['kind'], number>> = {}
  for (const part of parts) contents[part.kind] = (contents[part.kind] ?? 0) + 1
  return { ...card, contents, components: [...parts] }
}

function withLearned(
  row: IndexRow,
  parts: StoreComponent[] | undefined,
): IndexRow & { learned: boolean } {
  const card = cardOfRow(row)
  if (card.contents !== 'unknown' || !parts?.length) return { ...row, learned: false }
  return {
    ...row,
    card: JSON.stringify(learnedCard(card, parts)),
    components: parts,
    components_text: parts.map((part) => part.name).join(' '),
    learned: true,
  }
}

export function createStoreIndexRepository(db: Kysely<StoreIndexTables>) {
  async function insertComponents(
    trx: Kysely<StoreIndexTables>,
    rows: Array<{ listing: number; part: StoreComponent; learned: boolean }>,
  ) {
    for (let at = 0; at < rows.length; at += BATCH)
      await trx
        .insertInto('listing_component')
        .values(
          rows.slice(at, at + BATCH).map(({ listing, part, learned }) => ({
            listing,
            kind: part.kind,
            name: part.name,
            description: part.description ?? null,
            learned: learned ? 1 : 0,
          })),
        )
        .execute()
  }

  /** What was learned of this source's listings by fetching them, by listing id. */
  async function learnedOf(trx: Kysely<StoreIndexTables>, kind: string, sourceId: string) {
    const rows = await trx
      .selectFrom('listing_component as c')
      .innerJoin('listing as l', 'l.pk', 'c.listing')
      .select(['l.id', 'c.kind', 'c.name', 'c.description'])
      .where('l.kind', '=', kind)
      .where('l.source_id', '=', sourceId)
      .where('c.learned', '=', 1)
      .execute()
    const out = new Map<string, StoreComponent[]>()
    for (const row of rows) {
      const parts = out.get(row.id) ?? []
      parts.push({
        kind: row.kind as StoreComponent['kind'],
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
      })
      out.set(row.id, parts)
    }
    return out
  }

  return {
    ...createIndexReads(db),

    /** The revision a source was last indexed at, or null when it never was. */
    async sourceRevision(kind: string, sourceId: string): Promise<string | null> {
      const row = await db
        .selectFrom('source_state')
        .select('revision')
        .where('kind', '=', kind)
        .where('source_id', '=', sourceId)
        .executeTakeFirst()
      return row?.revision ?? null
    },

    /** When each source was last indexed, and why it could not be, by `<kind>\0<source id>`. */
    async sourceStates(): Promise<Map<string, { syncedAt: string; error: string | null }>> {
      const rows = await db
        .selectFrom('source_state')
        .select(['kind', 'source_id', 'synced_at', 'error'])
        .execute()
      return new Map(
        rows.map((row) => [
          `${row.kind}\u0000${row.source_id}`,
          { syncedAt: row.synced_at, error: row.error },
        ]),
      )
    },

    /** Replace every listing of one source with `rows`, in one transaction. */
    async replaceSource(
      kind: string,
      sourceId: string,
      rows: readonly IndexRow[],
      meta: { revision: string; now: string },
    ): Promise<void> {
      await db.transaction().execute(async (trx) => {
        const learned = await learnedOf(trx, kind, sourceId)
        await trx
          .deleteFrom('listing')
          .where('kind', '=', kind)
          .where('source_id', '=', sourceId)
          .execute()
        const components: Array<{ listing: number; part: StoreComponent; learned: boolean }> = []
        const filled = rows.map((row) => withLearned(row, learned.get(row.id)))
        for (let at = 0; at < filled.length; at += BATCH) {
          const batch = filled.slice(at, at + BATCH)
          const inserted = await trx
            .insertInto('listing')
            .values(batch.map(listingColumns))
            .returning(['pk', 'id'])
            .execute()
          const pkOf = new Map(inserted.map((row) => [row.id, row.pk]))
          for (const row of batch)
            for (const part of row.components)
              components.push({ listing: pkOf.get(row.id)!, part, learned: row.learned })
        }
        await insertComponents(trx, components)
        await trx
          .insertInto('source_state')
          .values({
            kind,
            source_id: sourceId,
            revision: meta.revision,
            count: rows.length,
            synced_at: meta.now,
            error: null,
          })
          .onConflict((conflict) =>
            conflict.columns(['kind', 'source_id']).doUpdateSet({
              revision: meta.revision,
              count: rows.length,
              synced_at: meta.now,
              error: null,
            }),
          )
          .execute()
      })
    },

    /** Drop the listings of a kind's sources that are gone (a source removed). */
    async keepSources(kind: string, sourceIds: readonly string[]): Promise<number> {
      return db.transaction().execute(async (trx) => {
        let gone = trx.deleteFrom('listing').where('kind', '=', kind)
        let state = trx.deleteFrom('source_state').where('kind', '=', kind)
        if (sourceIds.length > 0) {
          gone = gone.where('source_id', 'not in', sourceIds)
          state = state.where('source_id', 'not in', sourceIds)
        }
        const result = await gone.executeTakeFirst()
        await state.execute()
        return Number(result.numDeletedRows)
      })
    },

    /**
     * One listing per origin: every copy but the one under the highest-weight source (the first
     * indexed on a tie) is hidden, and shows on that one's page as "Also in".
     */
    async markDuplicates(): Promise<void> {
      await db
        .updateTable('listing as l')
        .set((eb) => ({
          hidden: eb
            .case()
            .when(
              eb.and([
                eb('l.origin', 'is not', null),
                eb.exists(
                  eb
                    .selectFrom('listing as o')
                    .select('o.pk')
                    .whereRef('o.origin', '=', 'l.origin')
                    .where((inner) =>
                      inner.or([
                        inner('o.weight', '>', inner.ref('l.weight')),
                        inner.and([
                          inner('o.weight', '=', inner.ref('l.weight')),
                          inner('o.pk', '<', inner.ref('l.pk')),
                        ]),
                      ]),
                    ),
                ),
              ]),
            )
            .then(1)
            .else(0)
            .end(),
        }))
        .execute()
    },

    /** Replace one person's state of a kind's listings. */
    async replaceState(userId: string, kind: string, rows: readonly StateRow[]): Promise<void> {
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('listing_state')
          .where('user_id', '=', userId)
          .where('kind', '=', kind)
          .execute()
        for (let at = 0; at < rows.length; at += BATCH)
          await trx
            .insertInto('listing_state')
            .values(rows.slice(at, at + BATCH).map((row) => ({ ...row, user_id: userId })))
            .execute()
      })
    },

    /**
     * What a fetched package contains, written back so its card and capability shelves show it
     * before it is installed. Ignored for a listing whose source already says.
     */
    async rememberComponents(ref: ListingRef, parts: readonly StoreComponent[]): Promise<boolean> {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('listing')
          .select(['pk', 'card'])
          .where('kind', '=', ref.kind)
          .where('id', '=', ref.id)
          .executeTakeFirst()
        if (!row) return false
        const card = cardOfRow(row)
        const learned = await trx
          .selectFrom('listing_component')
          .select('learned')
          .where('listing', '=', row.pk)
          .executeTakeFirst()
        // The source's own list stands; only an unknown one, or one learned before, is replaced.
        if (card.contents !== 'unknown' && learned?.learned !== 1) return false
        const next = JSON.stringify(learnedCard(card, parts))
        // Learned the same again (the page was opened twice): nothing moved, nothing to re-embed.
        if (learned?.learned === 1 && next === row.card) return false
        await trx.deleteFrom('listing_component').where('listing', '=', row.pk).execute()
        await insertComponents(
          trx,
          parts.map((part) => ({ listing: row.pk, part, learned: true })),
        )
        await trx
          .updateTable('listing')
          .set({
            components_text: parts.map((part) => part.name).join(' '),
            card: next,
          })
          .where('pk', '=', row.pk)
          .execute()
        return true
      })
    },
  }
}

export type StoreIndexRepository = ReturnType<typeof createStoreIndexRepository>
