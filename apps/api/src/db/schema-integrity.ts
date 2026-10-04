import { sql, type Kysely } from 'kysely'
import { Migrator, type MigrationProvider } from 'kysely/migration'
import type { AppDatabase } from './types'
import { createDatabase, destroyDatabase } from './connection'

type SchemaObject = { name: string; type: string; sql: string | null }
const references = new WeakMap<MigrationProvider, Promise<SchemaObject[]>>()

async function readSchema(db: Kysely<AppDatabase>): Promise<SchemaObject[]> {
  return (
    await sql<SchemaObject>`
    SELECT name, type, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
      AND name NOT IN ('kysely_migration', 'kysely_migration_lock', 'localix_migration_digest')
    ORDER BY type, name
  `.execute(db)
  ).rows
}

/** The schema `migrations` build, applied by the same Migrator to an empty in-memory database. */
async function referenceSchema(migrations: MigrationProvider): Promise<SchemaObject[]> {
  const db = createDatabase()
  try {
    // The seed's identity does not affect DDL. No user data or disk files enter this database.
    await sql`CREATE TEMP TABLE localix_migration_context (default_user_id TEXT NOT NULL)`.execute(
      db,
    )
    const { error } = await new Migrator({ db, provider: migrations }).migrateToLatest()
    if (error) throw error
    return await readSchema(db)
  } finally {
    await destroyDatabase(db)
  }
}

/**
 * The ledger says which migrations ran, not that their tables still exist or match. Compare the
 * physical DDL with the schema the same migrations build in memory, so a dropped index, a
 * hand-edited table or an edited already-applied migration is refused instead of served. No
 * second hand-maintained list of tables or columns exists to drift from the migrations.
 */
export async function validateSchema(
  db: Kysely<AppDatabase>,
  migrations: MigrationProvider,
): Promise<void> {
  let expected = references.get(migrations)
  if (!expected) {
    expected = referenceSchema(migrations)
    references.set(migrations, expected)
    void expected.catch(() => references.delete(migrations))
  }
  const [reference, actual] = await Promise.all([expected, readSchema(db)])
  const byName = new Map(actual.map((entry) => [entry.name, entry]))
  const differences: string[] = []
  for (const entry of reference) {
    const stored = byName.get(entry.name)
    if (!stored) differences.push(`missing ${entry.type} ${entry.name}`)
    else if (stored.type !== entry.type || stored.sql !== entry.sql)
      differences.push(`changed ${entry.type} ${entry.name}`)
    byName.delete(entry.name)
  }
  for (const entry of byName.values()) differences.push(`unexpected ${entry.type} ${entry.name}`)
  if (differences.length)
    throw new Error(
      `Localix schema drift: ${differences.join('; ')}. The database has been preserved unchanged. Restore a backup or select a fresh data directory; do not edit the migration ledger.`,
    )
}
