import { sql, type Kysely } from 'kysely'

// Mini app catalogs become marketplaces (`docs/extending/mini-app-marketplace.md`): one a person
// added is kept with its name, unique on this computer; what Localix keeps to judge each
// marketplace's signatures (its keys, its newest release, the shipped keys they came from) is kept
// for every marketplace read, built in, added or linked. The catalogs' tables go without their
// rows: the format they described is no longer read.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE mini_app_catalogs`.execute(db)
  await sql`DROP TABLE mini_app_linked_keys`.execute(db)
  await sql`
    CREATE TABLE mini_app_marketplaces (
      url text primary key not null,
      name text not null unique,
      added_at text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE mini_app_marketplace_trust (
      url text primary key not null,
      signing_keys text not null,
      published text,
      root text,
      updated_at text not null
    )
  `.execute(db)
}
