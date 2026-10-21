import { sql, type Kysely } from 'kysely'

// Notices a change-feed consumer gave up on after every attempt (`@localixai/change-feed`). They
// were only logged; they are now kept under their consumer until replayed, so a failure that
// outlived its retries can be seen and delivered again once its cause is fixed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE change_dead_letters (
      consumer text not null,
      stream text not null,
      seq integer not null,
      entity text not null,
      op text not null,
      ref_json text,
      error text not null,
      failed_at text not null,
      primary key (consumer, stream, seq)
    )
  `.execute(db)
}
