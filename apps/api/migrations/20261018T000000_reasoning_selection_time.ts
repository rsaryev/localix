import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE conversation_participants ADD COLUMN reasoning_selected_at TEXT`.execute(db)
  // Preserve the best historical evidence available before explicit effort timestamps existed.
  await sql`UPDATE conversation_participants SET reasoning_selected_at = model_selected_at WHERE model_selected_at IS NOT NULL`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE conversation_participants DROP COLUMN reasoning_selected_at`.execute(db)
}
