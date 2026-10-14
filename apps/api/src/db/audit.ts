import { sql } from 'kysely'
import { createDatabase, destroyDatabase } from './connection'
import { Migrator } from 'kysely/migration'
import { shippedMigrations } from './migration-provider'
import { validateSchema } from './schema-integrity'

/** Read-only on the source, including failed validation. Reports metadata, never row contents. */
export async function auditDatabase(filename: string) {
  const db = createDatabase({ filename, readonly: true })
  try {
    // A consistent read snapshot, even if the application is concurrently writing WAL pages.
    return await db.transaction().execute(async (snapshot) => {
      const integrity = (
        await sql<{ integrity_check: string }>`PRAGMA integrity_check`.execute(snapshot)
      ).rows
      const foreignKeys = (
        await sql<{
          table: string
          rowid: number | null
          parent: string
          fkid: number
        }>`PRAGMA foreign_key_check`.execute(snapshot)
      ).rows
      const errors: string[] = []
      let pendingMigrations: string[] = []
      try {
        const migrations = shippedMigrations()
        const known = await new Migrator({ db: snapshot, provider: migrations }).getMigrations()
        pendingMigrations = known.filter((m) => !m.executedAt).map((m) => m.name)
        // A database behind the build is not broken: the next start applies what is pending.
        // Its schema is compared only when it claims to be current, against the full set.
        if (pendingMigrations.length === 0) await validateSchema(snapshot, migrations)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      return {
        ok:
          errors.length === 0 &&
          pendingMigrations.length === 0 &&
          foreignKeys.length === 0 &&
          integrity.every((row) => row.integrity_check === 'ok'),
        pendingMigrations,
        integrity: integrity.map((row) => row.integrity_check),
        foreignKeyViolations: foreignKeys,
        schemaErrors: errors,
      }
    })
  } finally {
    await destroyDatabase(db)
  }
}
