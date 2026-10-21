import type { Kysely } from 'kysely'
import type { ChangeFeedTables } from './tables'

/** The newest seq recorded on `stream`, or 0 for an empty stream. */
export async function headOf(db: Kysely<ChangeFeedTables>, stream: string): Promise<number> {
  const row = await db
    .selectFrom('change_events')
    .select((eb) => eb.fn.max('seq').as('max'))
    .where('stream', '=', stream)
    .executeTakeFirst()
  return Number(row?.max ?? 0)
}

/** One consumer's stored position on one stream. */
export function cursorStore(db: Kysely<ChangeFeedTables>, consumer: string, stream: string) {
  return {
    async load(): Promise<number | null> {
      const row = await db
        .selectFrom('change_cursors')
        .select('seq')
        .where('consumer', '=', consumer)
        .where('stream', '=', stream)
        .executeTakeFirst()
      return row ? row.seq : null
    },

    async save(seq: number): Promise<void> {
      const updated_at = new Date().toISOString()
      await db
        .insertInto('change_cursors')
        .values({ consumer, stream, seq, updated_at })
        .onConflict((oc) => oc.columns(['consumer', 'stream']).doUpdateSet({ seq, updated_at }))
        .execute()
    },
  }
}
