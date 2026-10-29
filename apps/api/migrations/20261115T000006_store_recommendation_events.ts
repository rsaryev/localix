import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('store_recommendation_events')
    .addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
    .addColumn('user_id', 'text', (column) => column.notNull())
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('listing_id', 'text', (column) => column.notNull())
    .addColumn('event', 'text', (column) => column.notNull())
    .addColumn('slot', 'integer')
    .addColumn('source', 'text')
    .addColumn('at', 'text', (column) => column.notNull())
    .execute()
  await db.schema
    .createIndex('store_recommendation_events_by_listing')
    .on('store_recommendation_events')
    .columns(['user_id', 'kind', 'listing_id', 'at'])
    .execute()
  await db.schema
    .createIndex('store_recommendation_events_by_time')
    .on('store_recommendation_events')
    .columns(['user_id', 'at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('store_recommendation_events').execute()
}
