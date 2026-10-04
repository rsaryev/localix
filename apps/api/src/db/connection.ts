import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync, statSync } from 'node:fs'
import { chmod, mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { CompiledQuery, Kysely, SqliteAdapter, SqliteDialect, type DialectAdapter } from 'kysely'

import type { AppDatabase } from './types'

type SqliteDatabase = InstanceType<typeof Database>
type SqliteBindings = Parameters<SqliteDatabase['prepare']>[0] extends string
  ? Parameters<ReturnType<SqliteDatabase['prepare']>['all']>[0]
  : never

type DialectStatement = {
  readonly reader: boolean
  all(parameters: ReadonlyArray<unknown>): unknown[]
  run(parameters: ReadonlyArray<unknown>): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
  iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown>
}

type DialectDatabase = {
  close(): void
  prepare(sql: string): DialectStatement
}

const sqliteHandles = new WeakMap<Kysely<AppDatabase>, SqliteDatabase>()
const sqliteFiles = new WeakMap<Kysely<AppDatabase>, string>()

function createDialectDatabase(
  filename: string,
  readonly = false,
): {
  sqlite: SqliteDatabase
  dialectDatabase: DialectDatabase
} {
  const sqlite = new Database(filename, { create: !readonly, readonly, strict: true })

  return {
    sqlite,
    dialectDatabase: {
      close() {
        sqlite.close(false)
      },
      prepare(sql: string) {
        const statement = sqlite.prepare(sql)
        return {
          get reader() {
            // SQLite knows the result shape; keyword guesses lose CTEs, comments
            // and mutation RETURNING rows. Kysely prepares a fresh statement per call.
            return statement.columnNames.length > 0
          },
          all(parameters: ReadonlyArray<unknown>) {
            try {
              return statement.all(...(parameters as SqliteBindings[]))
            } finally {
              statement.finalize()
            }
          },
          run(parameters: ReadonlyArray<unknown>) {
            try {
              const result = statement.run(...(parameters as SqliteBindings[]))
              return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
            } finally {
              statement.finalize()
            }
          },
          *iterate(parameters: ReadonlyArray<unknown>) {
            try {
              yield* statement.iterate(...(parameters as SqliteBindings[]))
            } finally {
              // Includes early cancellation of a Kysely stream; do not pin a read lock.
              statement.finalize()
            }
          },
        }
      },
    },
  }
}

/**
 * Narrow the database file and its WAL siblings to owner-only. Best-effort per path: a missing
 * sibling (no WAL yet) and an un-chmod-able filesystem are both normal, and neither is a reason to
 * refuse to start — the alternative is a server that will not boot on a share that ignores modes.
 */
function restrictDatabaseFiles(filename: string): void {
  for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
    try {
      if ((statSync(path).mode & 0o777) !== 0o600) chmodSync(path, 0o600)
    } catch {
      // absent sibling or a filesystem without POSIX modes
    }
  }
}

/**
 * SQLite runs DDL inside a transaction, but Kysely's adapter reports that it cannot, so the
 * Migrator applied each migration bare: a crash between two statements left a half-changed
 * schema the ledger no longer described. Reporting the capability SQLite actually has lets the
 * Migrator run pending migrations in one transaction, and accept one from the caller.
 */
class TransactionalDdlSqliteAdapter extends SqliteAdapter {
  override get supportsTransactionalDdl(): boolean {
    return true
  }
}

class TransactionalDdlSqliteDialect extends SqliteDialect {
  override createAdapter(): DialectAdapter {
    return new TransactionalDdlSqliteAdapter()
  }
}

export interface CreateDatabaseOptions {
  filename?: string
  /** Diagnostics must not create files, change permissions, or switch journaling. */
  readonly?: boolean
}

export function createDatabase(options: CreateDatabaseOptions = {}): Kysely<AppDatabase> {
  const filename = options.filename ? resolve(options.filename) : ':memory:'

  if (options.readonly && filename === ':memory:')
    throw new Error('Read-only database requires a file')
  if (filename !== ':memory:' && !options.readonly) {
    mkdirSync(dirname(filename), { recursive: true })
  }

  const { sqlite, dialectDatabase } = createDialectDatabase(filename, options.readonly)
  // OWNER-ONLY, repaired on every open. This file holds plaintext that the vault deliberately
  // does NOT cover: `plugins.config` ("may contain secrets" per db/types), `mcp_servers.config`
  // (the server's `env` tokens and `Authorization` headers), and the whole transcript. SQLite
  // creates it — and its -wal/-shm siblings — at the process default (0644 here), so any other
  // local account could read all of it, while the migration BACKUP of the same bytes was already
  // written 0600 two functions down. Repairing rather than only setting on create is what fixes an
  // existing install; a chmod that fails (an exotic filesystem) must not stop the server booting.
  // BEFORE `journal_mode = WAL` below, deliberately: on a FRESH database the -wal/-shm siblings do
  // not exist yet, so their chmod is a no-op here and they end up 0600 only because SQLite derives
  // journal/WAL/SHM permissions from the main file's mode (`findCreateFileMode` in os_unix.c). That
  // dependency is load-bearing — moving the pragma above this call would silently leave a fresh
  // install with a 0644 -wal while the test, which exercises the same order, still passes.
  if (filename !== ':memory:' && !options.readonly) restrictDatabaseFiles(filename)
  sqlite.exec('PRAGMA foreign_keys = ON;')
  if (options.readonly) sqlite.exec('PRAGMA query_only = ON;')
  else sqlite.exec('PRAGMA journal_mode = WAL;')
  // NORMAL is safe under WAL (a crash can lose the last txn but never corrupts);
  // busy_timeout lets writers wait out a brief lock instead of throwing SQLITE_BUSY.
  sqlite.exec('PRAGMA synchronous = NORMAL;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')

  const db = new Kysely<AppDatabase>({
    dialect: new TransactionalDdlSqliteDialect({
      database: dialectDatabase,
      onCreateConnection: async (connection) => {
        await connection.executeQuery(CompiledQuery.raw('PRAGMA foreign_keys = ON'))
      },
    }),
  })

  sqliteHandles.set(db, sqlite)
  sqliteFiles.set(db, filename)
  return db
}

/**
 * Write a transactionally consistent pre-migration snapshot and retain only the
 * two newest generations. `Database.serialize()` includes committed WAL pages,
 * unlike copying the main `.db` file while WAL mode is active.
 */
export async function backupDatabaseBeforeMigration(
  db: Kysely<AppDatabase>,
): Promise<string | undefined> {
  const sqlite = sqliteHandles.get(db)
  const filename = sqliteFiles.get(db)
  if (!sqlite || !filename || filename === ':memory:') return undefined
  const backupDir = join(dirname(filename), 'backups', 'migrations')
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = join(backupDir, `${stamp}-${basename(filename)}`)
  await writeFile(backupFile, sqlite.serialize(), { mode: 0o600 })
  await chmod(backupFile, 0o600)

  const backups = (await readdir(backupDir))
    .filter((name) => name.endsWith(`-${basename(filename)}`))
    .sort()
  for (const stale of backups.slice(0, -2)) await unlink(join(backupDir, stale)).catch(() => {})
  return backupFile
}

export async function destroyDatabase(db: Kysely<AppDatabase>): Promise<void> {
  await db.destroy()
  sqliteHandles.get(db)?.close(false)
}
