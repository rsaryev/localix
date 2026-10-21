/**
 * Notices a consumer gave up on. A notice whose handler still fails after every attempt is not
 * dropped: it is kept here, under its consumer, so it can be seen and replayed once the cause is
 * fixed. The consumer moves on; its reconcile covers what the notice would have said meanwhile.
 */
import type { Kysely } from 'kysely'
import type { ChangeFeedTables } from './tables'

export interface DeadLetter {
  seq: number
  entity: string
  op: string
  ref_json: string | null
  error: string
  failed_at: string
}

export function deadLetterStore(db: Kysely<ChangeFeedTables>, consumer: string, stream: string) {
  const mine = () =>
    db
      .selectFrom('change_dead_letters')
      .where('consumer', '=', consumer)
      .where('stream', '=', stream)

  return {
    /** Keep a given-up notice; a second failure of the same seq updates its error. */
    async put(row: Omit<DeadLetter, 'failed_at'>): Promise<void> {
      const failed_at = new Date().toISOString()
      await db
        .insertInto('change_dead_letters')
        .values({ consumer, stream, ...row, failed_at })
        .onConflict((oc) =>
          oc.columns(['consumer', 'stream', 'seq']).doUpdateSet({ error: row.error, failed_at }),
        )
        .execute()
    },

    list(): Promise<DeadLetter[]> {
      return mine()
        .select(['seq', 'entity', 'op', 'ref_json', 'error', 'failed_at'])
        .orderBy('seq')
        .execute()
    },

    async count(): Promise<number> {
      const row = await mine()
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst()
      return Number(row?.n ?? 0)
    },

    async remove(seq: number): Promise<void> {
      await db
        .deleteFrom('change_dead_letters')
        .where('consumer', '=', consumer)
        .where('stream', '=', stream)
        .where('seq', '=', seq)
        .execute()
    },
  }
}
