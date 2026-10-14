import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql, type Kysely } from 'kysely'
import type { MigrationProvider } from 'kysely/migration'

/**
 * A MIGRATION IS IMMUTABLE FROM THE MOMENT ANY DATABASE RAN IT — and this module is what holds
 * that line before the database is touched.
 *
 * The defect it exists for happened more than once: a migration that had already run on a
 * developer's database (the dev server applies migrations as soon as a file is saved) was renamed
 * or edited "because it was not committed yet". Renamed, every database that had run it refused to
 * boot with Kysely's bare "previously executed migration … is missing" and the dev API
 * restarted in a loop; edited, it silently left those databases on a schema no file describes.
 * Neither is a question of git — a working tree's uncommitted migration is as final as a
 * released one once a database has recorded it.
 *
 * So the ledger keeps a digest of every migration a database ran, and before migrating:
 *   - a recorded migration with no file is refused, naming the file to restore and the likely
 *     rename (a file with the same timestamp);
 *   - a recorded migration whose file changed since it ran is refused, naming it.
 * Both errors say the one correct fix: restore the file exactly as it ran and put the change in a
 * NEW migration (apps/api/migrations/README.md).
 *
 * The digest is of the file's code with comments and whitespace removed, so reformatting or
 * rewording a comment is not an edit. The shipped bundle embeds the same files verbatim, so a
 * database moved between the dev server and the packaged app reads the same digests.
 */

export const MIGRATION_DIGEST_TABLE = 'localix_migration_digest'

export class MigrationLedgerError extends Error {
  override name = 'MigrationLedgerError'
}

const README = 'apps/api/migrations/README.md'

/** The file's code with comments and whitespace removed. */
export function normalizeMigrationSource(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, '')
}

export function migrationDigest(text: string): string {
  return new Bun.CryptoHasher('sha256').update(normalizeMigrationSource(text)).digest('hex')
}

/** Where a migration's text comes from: a folder of files, or a lookup (the bundle's embedded copy). */
export type MigrationSources = string | ((name: string) => string | undefined)

const readSource = (sources: MigrationSources, name: string): string | undefined => {
  if (typeof sources === 'function') return sources(name)
  for (const extension of ['.ts', '.js']) {
    try {
      return readFileSync(join(sources, `${name}${extension}`), 'utf8')
    } catch {
      // try the next extension
    }
  }
  return undefined
}

async function tableExists<DB>(db: Kysely<DB>, table: string): Promise<boolean> {
  const row = await sql<{ name: string }>`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ${table}
  `.execute(db)
  return row.rows.length > 0
}

async function executedNames<DB>(db: Kysely<DB>): Promise<string[]> {
  if (!(await tableExists(db, 'kysely_migration'))) return []
  const rows = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db)
  return rows.rows.map((row) => row.name)
}

async function ensureDigestTable<DB>(db: Kysely<DB>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql.table(MIGRATION_DIGEST_TABLE)} (
      name TEXT PRIMARY KEY NOT NULL,
      digest TEXT NOT NULL
    )
  `.execute(db)
}

/**
 * Refuse a database whose recorded migrations no longer match the files. Runs before any
 * migration; `sources` is where the shipped text lives (absent for an in-memory provider, which
 * then gets only the missing-file check).
 */
export async function verifyMigrationLedger<DB>(
  db: Kysely<DB>,
  provider: MigrationProvider,
  sources?: MigrationSources,
): Promise<void> {
  const executed = await executedNames(db)
  if (executed.length === 0) return
  const known = Object.keys(await provider.getMigrations())
  const missing = executed.filter((name) => !known.includes(name))
  if (missing.length > 0) {
    const lines = missing.map((name) => {
      const renamed = known.find((other) => other.slice(0, 15) === name.slice(0, 15))
      return `  - ${name}${renamed ? ` (did it become ${renamed}?)` : ''}`
    })
    throw new MigrationLedgerError(
      [
        'This database already ran migration(s) that no longer have a file:',
        ...lines,
        'A migration is immutable once any database has run it — the dev server runs a migration',
        'as soon as it is saved, committed or not. Restore each file under its original name,',
        `exactly as it ran, and put the change in a NEW migration. See ${README}.`,
      ].join('\n'),
    )
  }
  if (!sources || !(await tableExists(db, MIGRATION_DIGEST_TABLE))) return
  const recorded = await sql<{ name: string; digest: string }>`
    SELECT name, digest FROM ${sql.table(MIGRATION_DIGEST_TABLE)}
  `.execute(db)
  const changed = recorded.rows.filter((row) => {
    const source = readSource(sources, row.name)
    return source !== undefined && migrationDigest(source) !== row.digest
  })
  if (changed.length > 0) {
    throw new MigrationLedgerError(
      [
        'Migration file(s) changed after this database ran them:',
        ...changed.map((row) => `  - ${row.name}`),
        'The database keeps the schema the old code produced, so the edit would never reach it.',
        `Revert the edit and put the change in a NEW migration. See ${README}.`,
      ].join('\n'),
    )
  }
}

/** Record the digest of every executed migration that has none yet (first sight is trusted). */
export async function recordMigrationDigests<DB>(
  db: Kysely<DB>,
  sources?: MigrationSources,
): Promise<void> {
  if (!sources) return
  await ensureDigestTable(db)
  for (const name of await executedNames(db)) {
    const source = readSource(sources, name)
    if (source === undefined) continue
    await sql`
      INSERT OR IGNORE INTO ${sql.table(MIGRATION_DIGEST_TABLE)} (name, digest)
      VALUES (${name}, ${migrationDigest(source)})
    `.execute(db)
  }
}
