import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db/types'
import type { Kysely } from 'kysely'
import { createWorkRegistry, type StartWork } from './registry'
import { createWorkRepository } from './repository'

let db: Kysely<AppDatabase>

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  for (const [id, user] of [
    ['sA', 'u1'],
    ['sB', 'u1'],
    ['sC', 'u2'],
  ])
    await db
      .insertInto('agent_sessions')
      .values({ project_id: 'PRJ-test', id, user_id: user, title: id })
      .execute()
})
afterEach(() => destroyDatabase(db))

const registry = () => createWorkRegistry({ repo: createWorkRepository(db) })
const job = (toolCallId: string, userId: string, sessionId: string): StartWork => ({
  owner: { userId, sessionId },
  kind: 'job',
  label: `run ${toolCallId}`,
  toolCallId,
  messageId: 'm1',
})

describe('one owner filter', () => {
  test("a session sees its own work, never another session's or another user's", () => {
    const work = registry()
    work.start(job('tc-A1', 'u1', 'sA'))
    work.start(job('tc-B1', 'u1', 'sB'))
    work.start(job('tc-C1', 'u2', 'sC'))
    expect(work.list({ userId: 'u1', sessionId: 'sA' }).map((r) => r.toolCallId)).toEqual(['tc-A1'])
    // Same short id in another session is a different job and does not resolve here.
    expect(work.resolve({ userId: 'u1', sessionId: 'sB' }, 'bg-1')?.toolCallId).toBe('tc-B1')
    expect(work.resolve({ userId: 'u1', sessionId: 'sA' }, 'tc-B1')).toBeUndefined()
    expect(work.resolve({ userId: 'u1', sessionId: 'sC' }, 'bg-1')).toBeUndefined()
  })
})

describe('one id namespace per session', () => {
  test('ids never repeat within a session, even after the work ended', () => {
    const work = registry()
    work.start(job('tc-1', 'u1', 'sA'))
    work.end('tc-1', { status: 'succeeded', exitCode: 0 })
    // The old map reused the lowest free id, so "bg-1 finished" and a new bg-1 were two jobs.
    expect(work.start(job('tc-2', 'u1', 'sA')).displayId).toBe('bg-2')
    // Each session and each prefix counts on its own.
    expect(work.start(job('tc-3', 'u1', 'sB')).displayId).toBe('bg-1')
    expect(work.mint({ userId: 'u1', sessionId: 'sA' }, 'monitor')).toBe('mon-1')
  })

  test('a restart learns the ids already spent instead of reissuing them', async () => {
    const before = registry()
    before.start(job('tc-1', 'u1', 'sA'))
    before.start(job('tc-2', 'u1', 'sA'))
    before.mint({ userId: 'u1', sessionId: 'sA' }, 'monitor')
    before.start({ ...job('tc-m', 'u1', 'sA'), kind: 'monitor', displayId: 'mon-1' })
    await before.flushWrites()

    const after = registry()
    await after.hydrate()
    expect(after.start(job('tc-3', 'u1', 'sA')).displayId).toBe('bg-3')
    expect(after.mint({ userId: 'u1', sessionId: 'sA' }, 'monitor')).toBe('mon-2')
  })
})

describe('what a restart says about running work', () => {
  test('work the dead process left running is LOST, on its row and in the answer', async () => {
    const before = registry()
    before.start(job('tc-live', 'u1', 'sA'))
    before.start(job('tc-done', 'u1', 'sA'))
    before.end('tc-done', { status: 'failed', exitCode: 1 })
    await before.flushWrites()

    const lost = await registry().hydrate()
    expect(lost.map((record) => [record.toolCallId, record.status, record.messageId])).toEqual([
      ['tc-live', 'lost', 'm1'],
    ])
    const rows = await db.selectFrom('work_records').select(['tool_call_id', 'status']).execute()
    expect(Object.fromEntries(rows.map((row) => [row.tool_call_id, row.status]))).toEqual({
      'tc-live': 'lost',
      'tc-done': 'failed',
    })
  })

  test('a MONITOR waits for its trigger: adopted when it resumed, lost when it did not', async () => {
    const before = registry()
    before.start({ ...job('tc-poll', 'u1', 'sA'), kind: 'monitor', displayId: 'mon-1' })
    before.start({ ...job('tc-watch', 'u1', 'sA'), kind: 'monitor', displayId: 'mon-2' })
    before.recordEvents('tc-poll', [{ text: 'deploying', at: 0 }])
    await before.flushWrites()

    const after = registry()
    // Not lost at hydrate: its schedule is a trigger's row, which has not loaded yet.
    expect(await after.hydrate()).toEqual([])
    expect(after.list({ userId: 'u1', sessionId: 'sA' })).toEqual([])
    expect(after.adopt('tc-poll')).toMatchObject({ status: 'running', eventCount: 1 })
    expect((await after.losePending()).map((r) => [r.toolCallId, r.status])).toEqual([
      ['tc-watch', 'lost'],
    ])
    expect(after.list({ userId: 'u1', sessionId: 'sA' }).map((r) => r.displayId)).toEqual(['mon-1'])
    const rows = await db
      .selectFrom('work_records')
      .select(['tool_call_id', 'status', 'last_event'])
      .execute()
    expect(rows).toContainEqual({ tool_call_id: 'tc-watch', status: 'lost', last_event: null })
    expect(rows).toContainEqual({
      tool_call_id: 'tc-poll',
      status: 'running',
      last_event: 'deploying',
    })
  })

  test('a handle that goes away without an end was stopped, and a late end changes nothing', async () => {
    const work = registry()
    work.start(job('tc-1', 'u1', 'sA'))
    work.release('tc-1')
    work.end('tc-1', { status: 'succeeded', exitCode: 0 })
    await work.flushWrites()
    const row = await db.selectFrom('work_records').select('status').executeTakeFirstOrThrow()
    expect(row.status).toBe('cancelled')
  })
})
