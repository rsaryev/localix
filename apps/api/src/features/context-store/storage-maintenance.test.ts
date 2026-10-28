import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir } from '@localixai/testing'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import {
  checkpointWal,
  ensureIncrementalVacuum,
  reclaimFreePages,
  storageUsage,
} from '../../db/storage'
import { COMPRESS_MIN_BYTES, decodeArtifactText, encodeArtifactText } from './artifact-codec'
import { compactArtifacts, deleteSessionChunks, sweepOrphanChunks } from './repository-maintenance'
import { createContextStoreRepository } from './repository'

const tempDir = makeTempDir('localix-storage-maintenance')
beforeAll(() => mkdir(tempDir, { recursive: true }))
afterAll(() => rm(tempDir, { recursive: true, force: true }))

const open = async () => {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  await sql`INSERT INTO agent_sessions (id, user_id, project_id, title) VALUES ('s1', 'u1', 'PRJ-test', 't')`.execute(
    db,
  )
  return db
}
const log = (n: number) => Array.from({ length: n }, (_, i) => `line ${i} ok`).join('\n')

describe('artifact codec', () => {
  test('small text stays plain and round-trips', () => {
    const stored = encodeArtifactText('short')
    expect(stored.encoding).toBe('plain')
    expect(decodeArtifactText(stored)).toBe('short')
  })

  test('large repetitive text is compressed and round-trips, multibyte included', () => {
    const text = `${log(2000)}\ncaf\u00e9 \u{1F30D}`
    const stored = encodeArtifactText(text)
    expect(stored.encoding).toBe('zstd')
    expect(stored.content).toBe('')
    expect(stored.content_z!.length).toBeLessThan(stored.byteLength / 2)
    expect(decodeArtifactText(stored)).toBe(text)
  })

  test('text under the threshold is never compressed, however repetitive', () => {
    const text = 'a'.repeat(COMPRESS_MIN_BYTES - 1)
    expect(encodeArtifactText(text).encoding).toBe('plain')
    expect(encodeArtifactText(`${text}a`).encoding).toBe('zstd')
  })
})

describe('stored artifacts', () => {
  test('a large output is stored compressed and read back whole', async () => {
    const db = await open()
    const store = createContextStoreRepository(db)
    const text = log(5000)
    await store.putToolOutputArtifact({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'c1',
      toolName: 'Bash',
      text,
      toolInput: {},
      isError: false,
    })
    const row = await db.selectFrom('tool_output_artifacts').selectAll().executeTakeFirstOrThrow()
    expect(row.encoding).toBe('zstd')
    expect(row.byte_length).toBe(new TextEncoder().encode(text).length)
    expect((await store.getToolOutputArtifact('u1', 's1', 'c1'))?.text).toBe(text)
    await destroyDatabase(db)
  })

  test('compactArtifacts converts old plain rows once and a second pass finds nothing', async () => {
    const db = await open()
    const store = createContextStoreRepository(db)
    const text = log(5000)
    // A row as written before outputs were compressed.
    await db
      .insertInto('tool_output_artifacts')
      .values({
        user_id: 'u1',
        session_id: 's1',
        tool_call_id: 'old',
        tool_name: 'Bash',
        content: text,
        encoding: 'plain',
        content_z: null,
        input_json: '{}',
        is_error: 0,
        byte_length: new TextEncoder().encode(text).length,
        created_at: 'x',
        updated_at: 'x',
      })
      .execute()
    const first = await compactArtifacts(db)
    expect(first.rows).toBe(1)
    expect(first.savedBytes).toBeGreaterThan(0)
    expect((await store.getToolOutputArtifact('u1', 's1', 'old'))?.text).toBe(text)
    expect(await compactArtifacts(db)).toEqual({ rows: 0, savedBytes: 0 })
    await destroyDatabase(db)
  })
})

describe('orphan search sections', () => {
  test('sections of a deleted session are swept and a live session keeps its own', async () => {
    const db = await open()
    const store = createContextStoreRepository(db)
    await sql`INSERT INTO agent_sessions (id, user_id, project_id, title) VALUES ('gone', 'u1', 'PRJ-test', 't')`.execute(
      db,
    )
    for (const sessionId of ['s1', 'gone']) {
      await store.indexToolOutput({
        userId: 'u1',
        sessionId,
        toolCallId: 'c',
        toolName: 'Bash',
        text: 'alpha beta',
      })
    }
    await sql`DELETE FROM agent_sessions WHERE id = 'gone'`.execute(db)
    expect(await sweepOrphanChunks(db)).toBe(1)
    expect(await store.searchChunks('u1', 's1', '"alpha"')).toHaveLength(1)
    await destroyDatabase(db)
  })
})

describe('session deletion', () => {
  test('deleteSessionChunks removes only the named sessions sections', async () => {
    const db = await open()
    const store = createContextStoreRepository(db)
    await sql`INSERT INTO agent_sessions (id, user_id, project_id, title) VALUES ('s2', 'u1', 'PRJ-test', 't')`.execute(
      db,
    )
    for (const sessionId of ['s1', 's2']) {
      await store.indexToolOutput({
        userId: 'u1',
        sessionId,
        toolCallId: 'c',
        toolName: 'Bash',
        text: 'alpha beta',
      })
    }
    await deleteSessionChunks(db, 'u1', ['s1'])
    expect(await store.searchChunks('u1', 's1', '"alpha"')).toEqual([])
    expect(await store.searchChunks('u1', 's2', '"alpha"')).toHaveLength(1)
    await destroyDatabase(db)
  })
})

describe('file size', () => {
  test('a new database is incremental, and deleting then reclaiming shrinks the file', async () => {
    const db = await open()
    expect((await ensureIncrementalVacuum(db)).status).toBe('already')
    const noise = () => crypto.randomUUID().repeat(200)
    for (let i = 0; i < 300; i += 1) {
      await sql`INSERT INTO tool_output_artifacts (user_id, session_id, tool_call_id, tool_name, content, input_json, is_error, byte_length, created_at, updated_at)
        VALUES ('u1', 's1', ${`c${i}`}, 'bash', ${noise()}, '{}', 0, 1, 'x', 'x')`.execute(db)
    }
    await checkpointWal(db)
    const before = (await storageUsage(db)).fileBytes
    await sql`DELETE FROM tool_output_artifacts`.execute(db)
    expect((await storageUsage(db)).freeBytes).toBeGreaterThan(0)
    await reclaimFreePages(db, 1_000_000)
    await checkpointWal(db)
    const after = await storageUsage(db)
    expect(after.freeBytes).toBe(0)
    expect(after.fileBytes).toBeLessThan(before / 2)
    await destroyDatabase(db)
  })

  test('an existing database in the default mode is converted once by a vacuum', async () => {
    const file = join(tempDir, `${randomUUID()}.sqlite`)
    const legacy = new (await import('bun:sqlite')).Database(file)
    legacy.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('a')")
    legacy.close()
    const db = createDatabase({ filename: file })
    expect(
      (await sql<{ auto_vacuum: number }>`PRAGMA auto_vacuum`.execute(db)).rows[0]!.auto_vacuum,
    ).toBe(0)
    expect((await ensureIncrementalVacuum(db)).status).toBe('converted')
    expect(
      (await sql<{ auto_vacuum: number }>`PRAGMA auto_vacuum`.execute(db)).rows[0]!.auto_vacuum,
    ).toBe(2)
    await destroyDatabase(db)
  })
})
