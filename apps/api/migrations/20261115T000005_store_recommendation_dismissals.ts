import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('store_recommendation_dismissals')
    .addColumn('user_id', 'text', (column) => column.notNull())
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('listing_id', 'text', (column) => column.notNull())
    .addColumn('reason', 'text', (column) => column.notNull())
    .addColumn('dismissed_at', 'text', (column) => column.notNull())
    .addPrimaryKeyConstraint('store_recommendation_dismissals_pk', ['user_id', 'kind', 'listing_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('store_recommendation_dismissals').execute()
}
