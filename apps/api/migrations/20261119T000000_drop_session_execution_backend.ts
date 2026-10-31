import { sql, type Kysely } from 'kysely'

/** Every session runs on this machine; nothing reads `execution_backend` or `execution_target`. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions DROP COLUMN execution_backend`.execute(db)
  await sql`ALTER TABLE agent_sessions DROP COLUMN execution_target`.execute(db)
}
