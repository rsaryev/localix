import { statfsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

import { sql, type Kysely } from 'kysely'

import { databaseFile } from './connection'
import type { AppDatabase } from './types'

// How the database file is kept from growing without bound, and how big it is. The file only
// shrinks if SQLite is told it may: with `auto_vacuum = INCREMENTAL` a delete puts its pages on a
// free list and `incremental_vacuum` hands them back; without it the pages stay, forever.

const one = async <T>(db: Kysely<AppDatabase>, text: string): Promise<T | undefined> => {
  const { rows } = await sql<Record<string, T>>`${sql.raw(text)}`.execute(db)
  return rows[0] ? (Object.values(rows[0])[0] as T) : undefined
}

export type VacuumOutcome =
  | { status: 'already' | 'memory' }
  | { status: 'converted'; ms: number }
  | { status: 'skipped'; reason: string }

/**
 * Switch an existing database to incremental auto-vacuum. The mode only takes hold at a full
 * `VACUUM`, which rewrites the file next to itself, so it needs about the database's size in free
 * space and holds the writer for the time the copy takes (a second or two per hundred MB). It runs
 * at most once per database; if the disk cannot hold the copy it does nothing and says why.
 */
export async function ensureIncrementalVacuum(db: Kysely<AppDatabase>): Promise<VacuumOutcome> {
  const file = databaseFile(db)
  if (!file) return { status: 'memory' }
  if ((await one<number>(db, 'PRAGMA auto_vacuum')) === 2) return { status: 'already' }
  const size = statSync(file).size
  const free = statfsSync(dirname(file))
  if (free.bavail * free.bsize < size * 1.5) {
    return { status: 'skipped', reason: 'not enough free disk space to rewrite the database' }
  }
  const started = performance.now()
  await sql`PRAGMA auto_vacuum = INCREMENTAL`.execute(db)
  await sql`VACUUM`.execute(db)
  return { status: 'converted', ms: Math.round(performance.now() - started) }
}

/** Give back up to `pages` free pages to the filesystem. Resolves to how many were free. */
export async function reclaimFreePages(db: Kysely<AppDatabase>, pages = 4096): Promise<number> {
  const free = (await one<number>(db, 'PRAGMA freelist_count')) ?? 0
  if (free > 0 && (await one<number>(db, 'PRAGMA auto_vacuum')) === 2) {
    await sql`${sql.raw(`PRAGMA incremental_vacuum(${Math.max(1, Math.floor(pages))})`)}`.execute(
      db,
    )
  }
  return free
}

/** Fold the write-ahead log into the file and empty it. A reader that is mid-query only delays it. */
export async function checkpointWal(db: Kysely<AppDatabase>): Promise<void> {
  await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db)
}

export interface StorageUsage {
  /** The database file and its write-ahead log, in bytes on disk. */
  fileBytes: number
  walBytes: number
  /** Pages SQLite holds but is not using: space a delete freed that has not been handed back. */
  freeBytes: number
  /** Where the live bytes are. */
  messageBytes: number
  toolOutputBytes: number
  /** What the tool outputs would take uncompressed, so the saving is visible. */
  toolOutputRawBytes: number
  searchIndexBytes: number
}

const sizeOf = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** A cheap readout: file sizes and a few aggregates, no `dbstat` scan. */
export async function storageUsage(db: Kysely<AppDatabase>): Promise<StorageUsage> {
  const file = databaseFile(db)
  const pageSize = (await one<number>(db, 'PRAGMA page_size')) ?? 4096
  const free = (await one<number>(db, 'PRAGMA freelist_count')) ?? 0
  const sum = async (query: string) => Number((await one<number>(db, query)) ?? 0)
  return {
    fileBytes: file ? sizeOf(file) : 0,
    walBytes: file ? sizeOf(`${file}-wal`) : 0,
    freeBytes: free * pageSize,
    messageBytes: await sum('SELECT SUM(LENGTH(payload_json)) FROM agent_messages'),
    toolOutputBytes: await sum(
      'SELECT SUM(LENGTH(content) + COALESCE(LENGTH(content_z), 0)) FROM tool_output_artifacts',
    ),
    toolOutputRawBytes: await sum('SELECT SUM(byte_length) FROM tool_output_artifacts'),
    searchIndexBytes: await sum(
      'SELECT SUM(LENGTH(content) + LENGTH(heading)) FROM tool_output_chunks',
    ),
  }
}
