import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FileExtraction } from '../extract/types'

/**
 * Every file's extraction, kept across restarts so reopening a project re-parses only what
 * changed.
 *
 * SQLite rather than one JSON document: an edit updates one row, a crash mid-write rolls back
 * instead of truncating the whole cache, and nothing rewrites megabytes to record one file. The
 * store is keyed by the extractor version — rows written by an older extractor are dropped on
 * open, so a fix reaches every file, not only the ones edited since.
 */
export interface CachedFile {
  path: string
  size: number
  mtimeMs: number
  /** SHA-256 of the bytes: a touched-but-unchanged file keeps its extraction. */
  hash: string
  /** Null for a file that was read but yields nothing (minified, unparsable). */
  extraction: FileExtraction | null
}

export interface ExtractionCache {
  load(): Map<string, CachedFile>
  write(changed: CachedFile[], removed: string[]): void
  close(): void
}

export function openExtractionCache(dir: string, extractorVersion: number): ExtractionCache {
  mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, 'extractions.sqlite'), { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    hash TEXT NOT NULL,
    extraction TEXT
  )`)
  const version = db.query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'extractor'`)
  if (version.get()?.value !== String(extractorVersion)) {
    db.transaction(() => {
      db.exec('DELETE FROM files')
      db.query(`INSERT OR REPLACE INTO meta (key, value) VALUES ('extractor', ?)`).run(
        String(extractorVersion),
      )
    })()
  }

  const upsert = db.query(
    `INSERT OR REPLACE INTO files (path, size, mtime_ms, hash, extraction) VALUES (?, ?, ?, ?, ?)`,
  )
  const remove = db.query(`DELETE FROM files WHERE path = ?`)

  return {
    load() {
      const rows = db
        .query<
          { path: string; size: number; mtime_ms: number; hash: string; extraction: string | null },
          []
        >(`SELECT path, size, mtime_ms, hash, extraction FROM files`)
        .all()
      const files = new Map<string, CachedFile>()
      for (const row of rows) {
        const extraction = parseExtraction(row.extraction)
        // A row that no longer parses is treated as absent: the file is simply read again.
        if (extraction === undefined) continue
        files.set(row.path, {
          path: row.path,
          size: row.size,
          mtimeMs: row.mtime_ms,
          hash: row.hash,
          extraction,
        })
      }
      return files
    },
    write(changed, removed) {
      if (changed.length === 0 && removed.length === 0) return
      db.transaction(() => {
        for (const file of changed) {
          upsert.run(
            file.path,
            file.size,
            file.mtimeMs,
            file.hash,
            file.extraction ? JSON.stringify(file.extraction) : null,
          )
        }
        for (const path of removed) remove.run(path)
      })()
    },
    close() {
      db.close()
    },
  }
}

function parseExtraction(text: string | null): FileExtraction | null | undefined {
  if (text === null) return null
  try {
    return JSON.parse(text) as FileExtraction
  } catch {
    return undefined
  }
}
