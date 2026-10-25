import { sql, type Kysely } from 'kysely'

/**
 * The typed-contribution registry never had a kind registered, so `extension_contribution` only ever
 * held nothing, `capability_policy_binding` was only deleted from, and the two revision columns of
 * `capability_source` stayed at their defaults. The tables, their trigger and indexes, and the
 * columns go.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS archive_source_contributions`.execute(db)
  await sql`DROP TABLE IF EXISTS extension_contribution`.execute(db)
  await sql`DROP TABLE IF EXISTS capability_policy_binding`.execute(db)
  await sql`ALTER TABLE capability_source DROP COLUMN contribution_revision`.execute(db)
  await sql`ALTER TABLE capability_source DROP COLUMN contribution_digest`.execute(db)
}
