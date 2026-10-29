import { sql, type Kysely } from 'kysely'

// The signing key of a catalog a person added, kept from its first signed read
// (`features/mini-apps/catalog-signature.ts`), and the installed mini apps the person keeps from
// updating on their own (`features/mini-apps/auto-update.ts`).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE mini_app_catalogs ADD COLUMN signing_key text`.execute(db)
  await sql`
    CREATE TABLE mini_app_auto_update_off (
      name text primary key not null,
      changed_at text not null
    )
  `.execute(db)
}
