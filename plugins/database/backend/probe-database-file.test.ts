import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'

import { probeDatabaseFile } from './probe-database-file'

const dir = await mkdtemp(join(tmpdir(), 'localix-db-probe-'))
afterAll(() => rm(dir, { recursive: true, force: true }))

async function write(name: string, contents: string | Uint8Array): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, contents)
  return path
}

describe('probeDatabaseFile', () => {
  test('identifies a REAL SQLite database', async () => {
    // Written by the actual engine, not a hand-made header: the point of probing is to
    // agree with what SQLite writes, and a fake would agree with the sniffer instead.
    const path = join(dir, 'real.db')
    const db = new Database(path)
    db.run('CREATE TABLE t (a INTEGER)')
    db.close()
    expect(await probeDatabaseFile(path)).toEqual({ openable: true, dialect: 'sqlite' })
  })

  test('a file named .db that is not a database is rejected, not opened', async () => {
    // The whole reason the probe exists: without it this path would be SAVED as a
    // SQLite connection and fail later, inside the driver, looking like corruption.
    const path = await write('notes.db', '# shopping list\n- milk\n')
    expect(await probeDatabaseFile(path)).toEqual({
      openable: false,
      reason: 'unrecognized-format',
    })
  })

  test('an empty file is unrecognized rather than an error', async () => {
    const path = await write('fresh.sqlite', '')
    expect(await probeDatabaseFile(path)).toEqual({
      openable: false,
      reason: 'unrecognized-format',
    })
  })

  test('a non-database extension is refused before any filesystem access', async () => {
    // Also the guard that stops the route being a readability oracle for arbitrary paths.
    expect(await probeDatabaseFile('/etc/passwd')).toEqual({
      openable: false,
      reason: 'not-a-database-extension',
    })
  })

  test('a missing file answers unreadable instead of throwing', async () => {
    expect(await probeDatabaseFile(join(dir, 'nope.sqlite'))).toEqual({
      openable: false,
      reason: 'unreadable',
    })
  })

  test('a directory named like a database answers unreadable', async () => {
    // `open()` succeeds on a directory on Linux and fails on macOS; `read()` fails on
    // both. Either way the verdict must be a sentence, never an unhandled rejection.
    const path = join(dir, 'bundle.db')
    await Bun.$`mkdir -p ${path}`.quiet()
    expect((await probeDatabaseFile(path)).openable).toBe(false)
  })
})
