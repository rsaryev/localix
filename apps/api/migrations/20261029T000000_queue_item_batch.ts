import { sql, type Kysely } from 'kysely'

// The band a queued item was claimed in together with others (`wake-queue/selection.ts`): a
// child's reports to one delegator, a monitor's burst, the person's lines typed in a row. Written
// with the lease and kept until the band is acknowledged, so a delivery a crash interrupted replays
// with exactly the rows, and the transcript row, it had. Null for an item claimed alone.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_queue_items ADD COLUMN batch_id TEXT`.execute(db)
}
