import { afterEach, expect, test } from 'bun:test'
import { sql, CompiledQuery, type Kysely } from 'kysely'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { up } from '../../migrations/20261014T000000_workspace_read_models'
import { createChatRepository } from '../features/chat/repository'
import { sessionFixture } from '../testing/session-fixture'
import { lastMessagesQuery } from '../features/chat/repository-last-message'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

test('the migration backfills counts and keeps insert/delete/move/rollback atomic', async () => {
  const db = createDatabase()
  databases.push(db)
  await sql`CREATE TABLE agent_sessions(id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, updated_at TEXT)`.execute(
    db,
  )
  await sql`CREATE TABLE agent_messages(id TEXT PRIMARY KEY, session_id TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE)`.execute(
    db,
  )
  await sql`INSERT INTO agent_sessions VALUES ('a', 'u', 'p', 'now'), ('b', 'u', 'p', 'now')`.execute(
    db,
  )
  await sql`INSERT INTO agent_messages VALUES ('one', 'a'), ('two', 'a')`.execute(db)
  await up(db as unknown as Kysely<unknown>)
  const counts = async () =>
    (
      await sql<{
        id: string
        message_count: number
      }>`SELECT id, message_count FROM agent_sessions ORDER BY id`.execute(db)
    ).rows
  expect(await counts()).toEqual([
    { id: 'a', message_count: 2 },
    { id: 'b', message_count: 0 },
  ])
  await sql`UPDATE agent_messages SET session_id = 'b' WHERE id = 'two'`.execute(db)
  await sql`DELETE FROM agent_messages WHERE id = 'one'`.execute(db)
  expect(await counts()).toEqual([
    { id: 'a', message_count: 0 },
    { id: 'b', message_count: 1 },
  ])
  await expect(
    db.transaction().execute(async (tx) => {
      await sql`INSERT INTO agent_messages VALUES ('rolled-back', 'a')`.execute(tx)
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect((await counts())[0]?.message_count).toBe(0)
  await sql`DELETE FROM agent_sessions WHERE id = 'b'`.execute(db)
  expect((await sql`SELECT * FROM agent_messages`.execute(db)).rows).toEqual([])
})

test('project roster filtering and ordering use the composite index without a temporary sort', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const plan = await db.executeQuery<{ detail: string }>(
    CompiledQuery.raw(
      'EXPLAIN QUERY PLAN SELECT id, title FROM agent_sessions WHERE user_id = ? AND project_id = ? AND session_kind = ? AND parent_session_id IS NULL ORDER BY updated_at DESC',
      ['user', 'project', 'chat'],
    ),
  )
  expect(
    plan.rows.some((row) => row.detail.includes('agent_sessions_user_project_updated_idx')),
  ).toBe(true)
  expect(plan.rows.some((row) => row.detail.includes('TEMP B-TREE'))).toBe(false)
})

test('session summaries read the persisted count without scanning historical messages', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const repo = createChatRepository(db)
  await repo.insertSession(sessionFixture({ id: 'chat', userId: 'owner', seq: 1 }))
  await repo.insertMessages(
    Array.from({ length: 40 }, (_, n) => ({
      id: `message-${n}`,
      sessionId: 'chat',
      userId: 'owner',
      payload: {
        id: `message-${n}`,
        role: 'user' as const,
        from: 'user' as const,
        content: `turn ${n}`,
      },
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    })),
  )
  expect((await repo.listSessions('owner'))[0]?.messageCount).toBe(40)
  await sql`DELETE FROM agent_messages WHERE session_id = 'chat'`.execute(db)
  expect((await repo.getSession('owner', 'chat'))?.messageCount).toBe(0)
})

test('preview lookup seeks the message tail once per session without scanning transcript rows', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const query = lastMessagesQuery(db, 'owner').compile()
  const plan = await db.executeQuery<{ detail: string }>(
    CompiledQuery.raw(`EXPLAIN QUERY PLAN ${query.sql}`, [...query.parameters]),
  )
  expect(
    plan.rows.some(
      (row) => row.detail.includes('SEARCH tail') && row.detail.includes('session_id=?'),
    ),
  ).toBe(true)
  expect(plan.rows.some((row) => /SCAN (m|tail)\b/.test(row.detail))).toBe(false)
  expect(plan.rows.some((row) => row.detail.includes('TEMP B-TREE'))).toBe(false)
})
