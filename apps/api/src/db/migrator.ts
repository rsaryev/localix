import { sql, type Kysely } from 'kysely'
import { Migrator, type MigrationProvider, type MigrationResult } from 'kysely/migration'

import type { AppDatabase } from './types'
import { DEFAULT_USER_ID } from '../lib/env'
import { validateSchema } from './schema-integrity'
import { shippedMigrationSources, shippedMigrations } from './migration-provider'
import {
  recordMigrationDigests,
  verifyMigrationLedger,
  type MigrationSources,
} from './migration-ledger'
import { backupDatabaseBeforeMigration } from './connection'

/**
 * Bring a database to the latest schema, or leave it exactly as it was.
 *
 * Pending migrations and the schema check run in ONE transaction, so a migration that fails, or
 * a result that does not match the schema the migrations define, rolls everything back. An
 * existing database is snapshotted first. Ordering, the ledger and a database that knows a
 * migration this build does not (a downgrade) are the Kysely Migrator's own checks.
 */
export async function migrateToLatest(
  db: Kysely<AppDatabase>,
  options: {
    defaultUserId?: string
    migrations?: MigrationProvider
    /** The files behind a custom `migrations` provider, for the digest check. */
    migrationFolder?: string
  } = {},
): Promise<MigrationResult[]> {
  const migrations = options.migrations ?? shippedMigrations()
  // Digests are read from files, so only the shipped folder has them; a test's in-memory
  // provider still gets the missing-file check.
  const folder: MigrationSources | undefined = options.migrations
    ? options.migrationFolder
    : await shippedMigrationSources()
  // Before anything touches the database: a migration it ran must still exist, unchanged.
  await verifyMigrationLedger(db, migrations, folder)
  const known = await new Migrator({ db, provider: migrations }).getMigrations()
  const hasHistory = known.some((migration) => migration.executedAt)
  if (hasHistory && known.some((migration) => !migration.executedAt))
    await backupDatabaseBeforeMigration(db)
  const defaultUserId = options.defaultUserId?.trim() || DEFAULT_USER_ID

  // Data migrations sometimes need the already-resolved single-user identity,
  // but shipped migration files must remain self-contained (the bundle compiles them
  // in on their own and they cannot import src/lib/env.ts). A TEMP table
  // keeps that runtime value on this SQLite connection without adding durable
  // schema or reading process.env from a migration.
  await sql`
    CREATE TEMP TABLE IF NOT EXISTS localix_migration_context (
      default_user_id TEXT NOT NULL
    )
  `.execute(db)
  await sql`DELETE FROM localix_migration_context`.execute(db)
  await sql`
    INSERT INTO localix_migration_context (default_user_id)
    VALUES (${defaultUserId})
  `.execute(db)

  const results = await db.transaction().execute(async (trx) => {
    const { error, results } = await new Migrator({
      db: trx,
      provider: migrations,
    }).migrateToLatest()
    if (error) throw error
    await validateSchema(trx, migrations)
    await recordMigrationDigests(trx, folder)
    return results ?? []
  })

  interruptedRuns = await reclassifyInterruptedRuns(db)

  return results
}

/**
 * Runs the previous process died in the middle of whose transcript notice is still pending.
 * Populated by {@link migrateToLatest}; read once by bootstrap after the chat service is ready.
 *
 * A module-level handoff rather than a changed return type: `migrateToLatest`'s result is the
 * migration list and two callers already destructure it.
 */
export interface InterruptedRunNotice {
  runId: string
  sessionId: string
  userId: string
  /** The participant that was interrupted — whose reply and tools the notice is about. */
  agentId: string
}

let interruptedRuns: ReadonlyArray<InterruptedRunNotice> = []

/**
 * Pending restart notices, with stable run ids that double as deterministic message ids. Reading
 * drains only this process-local handoff; the durable `pending` marker remains until the transcript
 * row is committed, so another process restart retries instead of losing the warning.
 */
export function takeInterruptedRuns(): ReadonlyArray<InterruptedRunNotice> {
  const runs = interruptedRuns
  interruptedRuns = []
  return runs
}

const RESTART_ERROR_MESSAGE = 'Agent runtime process restarted'
const RESTART_NOTICE_PENDING = JSON.stringify({
  message: RESTART_ERROR_MESSAGE,
  transcriptNotice: 'pending',
})
const RESTART_NOTICE_ANNOUNCED = JSON.stringify({
  message: RESTART_ERROR_MESSAGE,
  transcriptNotice: 'announced',
})

/**
 * Acknowledge one durable restart notice after its deterministic transcript row exists.
 *
 * This is intentionally after the insert. If the process dies between insert and acknowledgement,
 * the next boot retries with the same message id and `insertUiNote` observes the existing row
 * instead of duplicating it.
 */
export async function markInterruptedRunAnnounced(
  db: Kysely<AppDatabase>,
  runId: string,
): Promise<void> {
  await db
    .updateTable('agent_runs')
    .set({ error_json: RESTART_NOTICE_ANNOUNCED })
    .where('id', '=', runId)
    .where('status', '=', 'interrupted')
    .where('error_code', '=', 'PROCESS_RESTART')
    .where('error_json', '=', RESTART_NOTICE_PENDING)
    .execute()
}

/**
 * A row can remain `running` only when the previous process died before its terminal transaction.
 * Reclassify before accepting new work, so the unique one-active-run constraint never wedges a
 * session after a restart. The transcript handoff is durable: every pending row is returned on
 * every boot until the notice insert is acknowledged.
 *
 * `agent_runs` is the right source and the session's `runtime_status` is not: a CHAT session never
 * reaches `'running'` (`markRuntimeSessionStatus` returns early for chat, and `createSession` starts
 * it `'idle'`), so a sweep keyed on that column can only ever see workers. A run row is written for
 * every kind.
 *
 * UPDATE + SELECT in ONE transaction ensures the current boot sees both newly interrupted and
 * previously unacknowledged rows. Two booting processes may both read a pending row, but the run id
 * is also the deterministic message id, so the persistence seam makes that retry idempotent.
 */
async function reclassifyInterruptedRuns(
  db: Kysely<AppDatabase>,
): Promise<ReadonlyArray<InterruptedRunNotice>> {
  return db.transaction().execute(async (tx) => {
    await tx
      .updateTable('agent_runs')
      .set({
        status: 'interrupted',
        finished_at: new Date().toISOString(),
        error_code: 'PROCESS_RESTART',
        error_json: RESTART_NOTICE_PENDING,
      })
      .where('status', '=', 'running')
      .execute()

    // Joined, not looked up afterwards: the owner is needed to write the note, and a run whose
    // session was deleted in the meantime simply drops out of the join.
    return tx
      .selectFrom('agent_runs')
      .innerJoin('agent_sessions', 'agent_sessions.id', 'agent_runs.session_id')
      .select([
        'agent_runs.id as runId',
        'agent_runs.session_id as sessionId',
        'agent_runs.agent_id as agentId',
        'agent_sessions.user_id as userId',
      ])
      .where('agent_runs.status', '=', 'interrupted')
      .where('agent_runs.error_code', '=', 'PROCESS_RESTART')
      .where('agent_runs.error_json', '=', RESTART_NOTICE_PENDING)
      .execute()
  })
}
