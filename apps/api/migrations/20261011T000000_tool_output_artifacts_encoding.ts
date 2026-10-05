import { sql, type Kysely } from 'kysely'

// A tool output is the largest single kind of row in the database, and it is read rarely and
// whole. `encoding` says how `content` is stored: 'plain' (the text itself, every existing row)
// or 'zstd' (`content` is '' and `content_z` holds the compressed bytes). New rows are written
// compressed when that pays; the maintenance pass converts the old ones in small batches, so this
// migration only adds the columns and never rewrites a row.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tool_output_artifacts ADD COLUMN encoding TEXT NOT NULL DEFAULT 'plain'`.execute(
    db,
  )
  await sql`ALTER TABLE tool_output_artifacts ADD COLUMN content_z BLOB`.execute(db)
}
