import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_view_state')
    .addColumn('user_id', 'text', (column) => column.notNull())
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('value_json', 'text', (column) => column.notNull())
    .addColumn('revision', 'integer', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addPrimaryKeyConstraint('user_view_state_pk', ['user_id', 'kind', 'key'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_view_state').execute()
}
