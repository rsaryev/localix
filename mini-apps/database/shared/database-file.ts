/**
 * Identifying a database FILE — the one piece of knowledge shared by every layer that
 * has to answer "can Localix open this, and as which engine?":
 *
 *   - the desktop bundle, via the mini app's `fileAssociations` (the extension lists here
 *     and the ones declared there are locked together by a test in this directory)
 *   - the UI's file-editor contribution, deciding whether a path gets the database tab
 *   - the backend probe, which opens the file and reads its header before connecting
 *
 * Zero imports on purpose (no zod, no node): the browser bundle and the backend both
 * consume it, exactly like `driver-catalog.ts` beside it.
 *
 * EXTENSION IS A HINT, HEADER IS THE TRUTH. `.db` is the most common SQLite suffix and
 * also a perfectly ordinary name for a Berkeley DB, a LevelDB fragment or someone's pickle jar. Guessing `sqlite` from the four letters would hand the driver a
 * file it cannot open and report the engine's parse error as if the user's database were
 * corrupt. So the extension decides whether to LOOK, and the magic bytes decide WHAT it is.
 */

import type { DbDialect } from './driver-catalog'

/**
 * Suffixes worth probing. Kept deliberately wide (a claim to look, not to open):
 * `.db`/`.sqlite`/`.sqlite3`/`.db3` are the ubiquitous SQLite spellings, `.s3db`/`.sl3`
 * are the older Delphi/PHP-era ones still found in the wild.
 */
export const DATABASE_FILE_EXTENSIONS: readonly string[] = [
  'db',
  'sqlite',
  'sqlite3',
  'db3',
  's3db',
  'sl3',
]

const EXTENSION_SET = new Set(DATABASE_FILE_EXTENSIONS)

/** Lower-cased extension without the dot (`/a/B.SQLite` → `sqlite`); `''` when none. */
export function fileExtension(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * Does this path look like a database file worth probing? Name-only — a `true` here
 * means "open it and read the header", never "this is a database".
 */
export function isDatabaseFilePath(path: string): boolean {
  return EXTENSION_SET.has(fileExtension(path))
}

/** Bytes the probe must read to decide: the length of SQLite's signature. */
export const DATABASE_HEADER_BYTES = 16

/** `SQLite format 3\0` — the first 16 bytes of every SQLite database (file format spec §1.3). */
const SQLITE_MAGIC = 'SQLite format 3\0'

function asciiAt(header: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(header[offset + i] ?? 0)
  return out
}

/**
 * Which engine wrote this file, read from its header — or `null` for anything else
 * (including a zero-length file, which is a legitimate "not yet a database").
 *
 * Only the FILE-transport dialect (SQLite) can ever be returned; a network engine has no
 * file to sniff.
 */
export function sniffDatabaseDialect(header: Uint8Array): DbDialect | null {
  if (
    header.length >= SQLITE_MAGIC.length &&
    asciiAt(header, 0, SQLITE_MAGIC.length) === SQLITE_MAGIC
  ) {
    return 'sqlite'
  }
  return null
}

/** Why a probed path is not openable as a database. */
export type DatabaseFileRejection =
  | 'not-a-database-extension'
  | 'unreadable'
  | 'unrecognized-format'

/** What the probe route answers for one path. */
export type DatabaseFileProbe =
  | { openable: true; dialect: DbDialect }
  | { openable: false; reason: DatabaseFileRejection }

/** Sentence for a rejection — one wording, shared by the tab and any future caller. */
export function describeDatabaseFileRejection(reason: DatabaseFileRejection): string {
  switch (reason) {
    case 'not-a-database-extension':
      return 'This file is not a recognized database file.'
    case 'unreadable':
      return 'This file could not be read.'
    case 'unrecognized-format':
      return 'This file is not a SQLite database — its header does not match.'
  }
}
