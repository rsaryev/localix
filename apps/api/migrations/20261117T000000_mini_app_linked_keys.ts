import { sql, type Kysely } from 'kysely'

// The signing key of a catalog a list links to (a Localix Community author's), kept from its first
// signed read (`features/mini-apps/catalogs.ts`), as `mini_app_catalogs.signing_key` is for a
// catalog the person added.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE mini_app_linked_keys (
      url text primary key not null,
      signing_key text not null,
      kept_at text not null
    )
  `.execute(db)
}
