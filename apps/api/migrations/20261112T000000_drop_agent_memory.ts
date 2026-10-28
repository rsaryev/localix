import { sql, type Kysely } from 'kysely'

/**
 * The retired `memory` tool's table. Its notes moved to Markdown files long ago, and memory is Claude
 * Code's auto memory folder now, kept with the file tools; nothing reads or writes the table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS agent_memory`.execute(db)
}
