import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tool_output_artifacts ADD COLUMN participant TEXT`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tool_output_artifacts DROP COLUMN participant`.execute(db)
}
