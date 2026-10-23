import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DATABASE_FILE_EXTENSIONS,
  DATABASE_HEADER_BYTES,
  describeDatabaseFileRejection,
  fileExtension,
  isDatabaseFilePath,
  sniffDatabaseDialect,
} from './database-file'

const ascii = (text: string, length = text.length) => {
  const out = new Uint8Array(length)
  for (let i = 0; i < text.length && i < length; i += 1) out[i] = text.charCodeAt(i)
  return out
}

describe('database file identification', () => {
  test('extension is a hint that decides whether to LOOK', () => {
    expect(isDatabaseFilePath('/home/me/localix.db')).toBe(true)
    expect(isDatabaseFilePath('/home/me/app.SQLite3')).toBe(true)
    // DuckDB is not an engine here: its extensions are not claimed as database files.
    expect(isDatabaseFilePath('C:\\data\\warehouse.duckdb')).toBe(false)
    expect(isDatabaseFilePath('/home/me/notes.md')).toBe(false)
    // A dot-less name and a dotfile are both "no extension", never a database.
    expect(isDatabaseFilePath('/home/me/Makefile')).toBe(false)
    expect(isDatabaseFilePath('/home/me/.db')).toBe(false)
  })

  test('fileExtension lower-cases and handles both separators', () => {
    expect(fileExtension('/a/B.SQLITE')).toBe('sqlite')
    expect(fileExtension('C:\\a\\b.SQLite3')).toBe('sqlite3')
    expect(fileExtension('/a/b')).toBe('')
  })

  test('a SQLite header is recognized regardless of the file name', () => {
    // File-format spec §1.3: the first 16 bytes are `SQLite format 3\0`.
    expect(sniffDatabaseDialect(ascii('SQLite format 3\0'))).toBe('sqlite')
    expect(sniffDatabaseDialect(ascii('SQLite format 3\0extra trailing page'))).toBe('sqlite')
  })

  test('a DuckDB header is not a database Localix can open', () => {
    const header = new Uint8Array(DATABASE_HEADER_BYTES)
    header.set([0x06, 0xd7, 0x6f, 0x27, 0xc2, 0xda, 0xb3, 0xb9], 0) // checksum, any bytes
    header.set(ascii('DUCK'), 8)
    expect(sniffDatabaseDialect(header)).toBeNull()
  })

  test('anything else is unrecognized — including an empty or truncated file', () => {
    expect(sniffDatabaseDialect(new Uint8Array(0))).toBeNull()
    expect(sniffDatabaseDialect(ascii('SQLite'))).toBeNull() // truncated magic
    expect(sniffDatabaseDialect(ascii('# just a text file that someone named .db'))).toBeNull()
    // A Berkeley DB / LevelDB / pickle named `.db` is exactly the case that makes the
    // extension untrustworthy; none of them start with either magic.
    expect(sniffDatabaseDialect(new Uint8Array([0x00, 0x06, 0x15, 0x61, 0x00, 0x00]))).toBeNull()
  })

  test('16 header bytes cover both signatures', () => {
    expect(DATABASE_HEADER_BYTES).toBeGreaterThanOrEqual('SQLite format 3\0'.length)
    expect(DATABASE_HEADER_BYTES).toBeGreaterThanOrEqual(8 + 'DUCK'.length)
  })

  test('every rejection has a sentence a user can act on', () => {
    for (const reason of [
      'not-a-database-extension',
      'unreadable',
      'unrecognized-format',
    ] as const) {
      expect(describeDatabaseFileRejection(reason)).toMatch(/\.$/)
    }
  })

  test('the extensions claimed here and in the mini app manifest are the same set', () => {
    // The UI routes on DATABASE_FILE_EXTENSIONS; the OS routes on the mini app manifest. A file
    // type in one and not the other is a double-click that opens the wrong thing (or
    // an in-app viewer the OS never offers), which is precisely the drift this mini app
    // pair was built to close.
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'mini-app.json'), 'utf8'))
    const declared: string[] = manifest.fileAssociations
      .filter((entry: { name: string }) => entry.name.endsWith('Database'))
      .flatMap((entry: { ext: string[] }) => entry.ext)
    expect(new Set(declared)).toEqual(new Set(DATABASE_FILE_EXTENSIONS))
  })
})
