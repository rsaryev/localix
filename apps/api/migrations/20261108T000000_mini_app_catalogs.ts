import { sql, type Kysely } from 'kysely'

// The catalogs a person added to the mini app store (`features/mini-apps/catalogs.ts`), beside the
// hosted Localix catalog every installation reads.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE mini_app_catalogs (
      url text primary key not null,
      added_at text not null
    )
  `.execute(db)
}
