import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir } from '@localixai/testing'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createStorageService } from './service'

const tempDir = makeTempDir('localix-storage-service')
beforeAll(() => mkdir(tempDir, { recursive: true }))
afterAll(() => rm(tempDir, { recursive: true, force: true }))

const NOW = new Date('2026-10-05T00:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

const setup = async () => {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const session = (
    id: string,
    over: { ageDays: number; pinned?: number; status?: string; parent?: string },
  ) =>
    sql`INSERT INTO agent_sessions (id, user_id, project_id, title, last_message_at, is_pinned, runtime_status, parent_session_id, root_session_id)
      VALUES (${id}, 'u1', 'PRJ-test', 't', ${daysAgo(over.ageDays)}, ${over.pinned ?? 0}, ${over.status ?? 'idle'}, ${over.parent ?? null}, ${over.parent ?? null})`.execute(
      db,
    )
  await session('old', { ageDays: 90 })
  await session('old-child', { ageDays: 90, parent: 'old' })
  await session('old-pinned', { ageDays: 90, pinned: 1 })
  await session('old-running', { ageDays: 90, status: 'running' })
  await session('recent', { ageDays: 2 })
  for (const id of ['old', 'old-child', 'recent']) {
    await sql`INSERT INTO tool_output_artifacts (user_id, session_id, tool_call_id, tool_name, content, input_json, is_error, byte_length, created_at, updated_at)
      VALUES ('u1', ${id}, 'c', 'bash', 'x', '{}', 0, 1000, 'x', 'x')`.execute(db)
  }
  const deleted: string[] = []
  const service = createStorageService({
    db,
    now: () => NOW,
    deleteSession: async (_user, id) => {
      deleted.push(id)
      await sql`DELETE FROM agent_sessions WHERE id = ${id} OR parent_session_id = ${id}`.execute(
        db,
      )
    },
  })
  return { db, service, deleted }
}

describe('pruneOlderThan', () => {
  test('a dry run counts old, unpinned, idle conversations with their sub-agents and deletes nothing', async () => {
    const { db, service, deleted } = await setup()
    const result = await service.pruneOlderThan('u1', { olderThanDays: 30, dryRun: true })
    expect(result).toEqual({ sessions: 1, bytes: 2000, dryRun: true, failed: 0 })
    expect(deleted).toEqual([])
    await destroyDatabase(db)
  })

  test('a real run removes only those and leaves pinned, running and recent ones', async () => {
    const { db, service, deleted } = await setup()
    const result = await service.pruneOlderThan('u1', { olderThanDays: 30, dryRun: false })
    expect(result).toMatchObject({ sessions: 1, dryRun: false, failed: 0 })
    expect(deleted).toEqual(['old'])
    const left = await db.selectFrom('agent_sessions').select('id').orderBy('id').execute()
    expect(left.map((row) => row.id)).toEqual(['old-pinned', 'old-running', 'recent'])
    await destroyDatabase(db)
  })

  test('a window under a week is raised to a week, so a typo cannot clear recent work', async () => {
    const { db, service } = await setup()
    // 1 day would take 'recent' (2 days old); the floor is 7 days.
    const result = await service.pruneOlderThan('u1', { olderThanDays: 1, dryRun: true })
    expect(result.sessions).toBe(1)
    await destroyDatabase(db)
  })

  test('one conversation that fails to delete is counted and the rest still go', async () => {
    const { db } = await setup()
    await sql`INSERT INTO agent_sessions (id, user_id, project_id, title, last_message_at) VALUES ('old2', 'u1', 'PRJ-test', 't', ${daysAgo(80)})`.execute(
      db,
    )
    const warnings: string[] = []
    const service = createStorageService({
      db,
      now: () => NOW,
      warn: (message) => warnings.push(message),
      deleteSession: async (_user, id) => {
        if (id === 'old') throw new Error('boom')
        await sql`DELETE FROM agent_sessions WHERE id = ${id}`.execute(db)
      },
    })
    const result = await service.pruneOlderThan('u1', { olderThanDays: 30, dryRun: false })
    expect(result).toMatchObject({ sessions: 1, failed: 1 })
    expect(warnings[0]).toContain('boom')
    await destroyDatabase(db)
  })
})
