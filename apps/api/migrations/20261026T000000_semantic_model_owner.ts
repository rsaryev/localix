import { sql, type Kysely } from 'kysely'

// Semantic search may now embed with a cloud provider's model: the person who chose it is the
// one whose connection key the indexer uses. Null for a model that runs on this computer.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE semantic_settings ADD COLUMN owner_user_id TEXT`.execute(db)
}
