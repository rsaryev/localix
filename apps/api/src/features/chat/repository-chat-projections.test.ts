import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { routedAgent, sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from './repository'

describe('narrow chat projections', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createChatRepository>

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    repo = createChatRepository(db)
    for (let i = 0; i < 24; i++) {
      await repo.insertSession(
        sessionFixture({
          id: `chat-${i}`,
          seq: i + 1,
          isPinned: i === 0,
          updatedAt: `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`,
          agent: routedAgent({ modelId: 'test-model', reasoningEffort: 'high' }),
        }),
      )
    }
    for (const [index, overrides] of [
      { id: 'foreign', userId: 'other' },
      { id: 'system', sessionKind: 'system' as const },
      {
        id: 'child',
        sessionKind: 'subagent' as const,
        parentSessionId: 'chat-0',
        rootSessionId: 'chat-0',
      },
      { id: 'other-project', projectId: 'PRJ-other' },
    ].entries()) {
      await repo.insertSession(
        sessionFixture({ seq: 25 + index, updatedAt: '2026-10-02', ...overrides }),
      )
    }
  })

  afterEach(async () => destroyDatabase(db))

  test('bounds limits after owner and project filtering, with pins before recency', async () => {
    const opts = { projectId: 'PRJ-fixture' }
    const expected = ['chat-0', ...Array.from({ length: 19 }, (_, i) => `chat-${23 - i}`)]
    expect((await repo.listRecentChatSessions('user-1', opts)).map((row) => row.id)).toEqual(
      expected,
    )
    for (const limit of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        (await repo.listRecentChatSessions('user-1', { ...opts, limit })).map((row) => row.id),
      ).toEqual(expected)
    }
    expect(await repo.listRecentChatSessions('user-1', { ...opts, limit: 0 })).toEqual([])
    expect(
      (await repo.listRecentChatSessions('user-1', { ...opts, limit: 2 })).map((row) => row.id),
    ).toEqual(['chat-0', 'chat-23'])
  })

  test('null project filters projectless rows while an omitted project spans projects', async () => {
    expect(await repo.listRecentChatSessions('user-1', { projectId: null })).toEqual([])
    const rows = await repo.listRecentChatSessions('user-1', { limit: 100 })
    expect(rows).toHaveLength(25)
    expect(rows.map((row) => row.id)).toContain('other-project')
    expect(rows.map((row) => row.id)).not.toContain('foreign')
    expect(rows.map((row) => row.id)).not.toContain('system')
    expect(rows.map((row) => row.id)).not.toContain('child')
  })

  test('list and point reads share route fields, including an absent agent', async () => {
    const [row] = await repo.listRecentChatSessions('user-1', { limit: 1 })
    expect(await repo.getChatSessionProjection('user-1', 'chat-0')).toEqual(row)
    expect(row).toMatchObject({ modelId: 'test-model', reasoningEffort: 'high' })
    await sql`UPDATE agent_sessions SET agent_id = NULL, agent_name = NULL, provider_connection_id = NULL, model_id = '', reasoning_effort = 'medium' WHERE id = 'chat-0'`.execute(
      db,
    )
    expect(await repo.getChatSessionProjection('user-1', 'chat-0')).toEqual({
      ...row,
      agentId: null,
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    })
    for (const id of ['foreign', 'system', 'child', 'missing']) {
      expect(await repo.getChatSessionProjection('user-1', id)).toBeNull()
    }
  })
})
