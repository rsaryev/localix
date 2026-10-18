import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import type { HistorySearchRepo } from './history-search'
import { createGlobalSearchTool } from '../global-search/global-search'
import { createChatRepository } from '../../../chat/repository'

/** The history modes now live in `global_search`; these tests drive them through it. */
const createHistorySearchTool = (repo: HistorySearchRepo, userId: string) =>
  createGlobalSearchTool({ history: repo, userId, sessionId: 'session-test', projectId: null })

async function createTestDb() {
  const db = createDatabase() // in-memory
  await migrateToLatest(db)
  return db
}

async function insertMessage(
  db: Awaited<ReturnType<typeof createTestDb>>,
  opts: {
    id: string
    sessionId: string
    userId: string
    sequence: number
    role: string
    payloadJson: string
  },
) {
  await db
    .insertInto('agent_messages')
    .values({
      id: opts.id,
      session_id: opts.sessionId,
      user_id: opts.userId,
      sequence: opts.sequence,
      role: opts.role as 'user' | 'assistant' | 'tool',
      payload_json: opts.payloadJson,
    })
    .execute()
}

async function insertSession(
  db: Awaited<ReturnType<typeof createTestDb>>,
  opts: { id: string; userId: string },
) {
  await db
    .insertInto('agent_sessions')
    .values({
      project_id: 'PRJ-test',
      id: opts.id,
      user_id: opts.userId,
      title: 'Test session',
      // The route lives in `conversation_participants`; this row does not need one to exist.
    })
    .execute()
}

describe('global_search history tool', () => {
  test('query that matches returns snippets', async () => {
    const db = await createTestDb()
    await insertSession(db, { id: 'session_1', userId: 'user_1' })
    await insertMessage(db, {
      id: 'msg_1',
      sessionId: 'session_1',
      userId: 'user_1',
      sequence: 1,
      role: 'user',
      payloadJson: JSON.stringify({
        role: 'user',
        content: 'How do I configure TypeScript strictNullChecks?',
      }),
    })

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { query: 'TypeScript' })

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('TypeScript')
    const payload = JSON.parse(result.content) as {
      mode: string
      sessions: Array<{ sessionId: string }>
    }
    expect(payload.mode).toBe('discovery')
    expect(payload.sessions[0].sessionId).toBe('session_1')
  })

  test('query that matches nothing returns no matches message', async () => {
    const db = await createTestDb()
    await insertSession(db, { id: 'session_1', userId: 'user_1' })
    await insertMessage(db, {
      id: 'msg_1',
      sessionId: 'session_1',
      userId: 'user_1',
      sequence: 1,
      role: 'user',
      payloadJson: JSON.stringify({ role: 'user', content: 'Tell me about JavaScript.' }),
    })

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { query: 'xyznonexistentterm123' })

    expect(result.isError).toBeFalsy()
    expect(result.content).toBe('No matching messages found in conversation history.')
  })

  test('user isolation — another user messages do not appear', async () => {
    const db = await createTestDb()
    // Insert a provider_connection for user_2's session (via direct insert to session with no connection)
    await insertSession(db, { id: 'session_a', userId: 'user_1' })
    await insertSession(db, { id: 'session_b', userId: 'user_2' })

    await insertMessage(db, {
      id: 'msg_a1',
      sessionId: 'session_a',
      userId: 'user_1',
      sequence: 1,
      role: 'user',
      payloadJson: JSON.stringify({ role: 'user', content: 'secretword is only for user1' }),
    })
    await insertMessage(db, {
      id: 'msg_b1',
      sessionId: 'session_b',
      userId: 'user_2',
      sequence: 1,
      role: 'user',
      payloadJson: JSON.stringify({ role: 'user', content: 'secretword belongs to user2' }),
    })

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { query: 'secretword' })

    expect(result.isError).toBeFalsy()
    // Should only find the user_1 message
    const payload = JSON.parse(result.content) as { sessions: Array<{ sessionId: string }> }
    expect(payload.sessions).toHaveLength(1)
    expect(payload.sessions[0].sessionId).toBe('session_a')
  })

  test('limit parameter is respected', async () => {
    const db = await createTestDb()
    await insertSession(db, { id: 'session_1', userId: 'user_1' })

    for (let i = 1; i <= 5; i++) {
      await insertMessage(db, {
        id: `msg_${i}`,
        sessionId: 'session_1',
        userId: 'user_1',
        sequence: i,
        role: 'user',
        payloadJson: JSON.stringify({
          role: 'user',
          content: `This is a uniquekeyword message number ${i}`,
        }),
      })
    }

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { query: 'uniquekeyword', limit: 3 })

    const details = result.details as { count: number }
    expect(details.count).toBeLessThanOrEqual(3)
  })
})

describe('global_search history scroll mode', () => {
  async function seedSession(db: Awaited<ReturnType<typeof createTestDb>>, count: number) {
    await insertSession(db, { id: 'session_1', userId: 'user_1' })
    for (let i = 1; i <= count; i++) {
      await insertMessage(db, {
        id: `msg_${i}`,
        sessionId: 'session_1',
        userId: 'user_1',
        sequence: i,
        role: i % 2 === 1 ? 'user' : 'assistant',
        payloadJson: JSON.stringify({ role: 'user', content: `message number ${i}` }),
      })
    }
  }

  test('returns a ±window of messages around the anchor', async () => {
    const db = await createTestDb()
    await seedSession(db, 20)

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', {
      session_id: 'session_1',
      around_message_id: 'msg_10',
      window: 3,
    })

    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content) as {
      mode: string
      sessionId: string
      anchorMessageId: string
      messages: Array<{ id: string }>
    }
    expect(payload.mode).toBe('scroll')
    expect(payload.sessionId).toBe('session_1')
    expect(payload.anchorMessageId).toBe('msg_10')
    // window=3 → 3 before + anchor + 3 after
    expect(payload.messages.map((m) => m.id)).toEqual([
      'msg_7',
      'msg_8',
      'msg_9',
      'msg_10',
      'msg_11',
      'msg_12',
      'msg_13',
    ])
  })

  test('default anchor is the last message of the session', async () => {
    const db = await createTestDb()
    await seedSession(db, 20)

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { session_id: 'session_1', window: 2 })

    const payload = JSON.parse(result.content) as {
      anchorMessageId: string
      messages: Array<{ id: string }>
    }
    expect(payload.anchorMessageId).toBe('msg_20')
    // Anchor is last — nothing after it: 2 before + anchor.
    expect(payload.messages.map((m) => m.id)).toEqual(['msg_18', 'msg_19', 'msg_20'])
  })

  test('window defaults to 5 and rejects values over the cap via schema', async () => {
    const db = await createTestDb()
    await seedSession(db, 20)

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', {
      session_id: 'session_1',
      around_message_id: 'msg_10',
    })
    const payload = JSON.parse(result.content) as { messages: Array<{ id: string }> }
    // default window=5 → 5 before + anchor + 5 after = 11
    expect(payload.messages).toHaveLength(11)

    // The schema caps window at 15 (LLM-side validation).
    const { globalSearchInputSchema } = await import('../global-search/global-search')
    expect(globalSearchInputSchema.safeParse({ session_id: 'session_1', window: 16 }).success).toBe(
      false,
    )
    expect(globalSearchInputSchema.safeParse({ session_id: 'session_1', window: 15 }).success).toBe(
      true,
    )
  })

  test('unknown session or foreign anchor returns a clean message', async () => {
    const db = await createTestDb()
    await seedSession(db, 3)

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { session_id: 'nope' })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('No messages found')

    // Anchor exists but belongs to another session.
    await insertSession(db, { id: 'session_2', userId: 'user_1' })
    const result2 = await tool.execute('tc_2', {
      session_id: 'session_2',
      around_message_id: 'msg_1',
    })
    expect(result2.content).toContain('No messages found')
  })

  // A checkpoint card or a folded answer points at a message by id alone; following it must not
  // require the model to know which session it is in.
  test('a message id alone scrolls around it in its own session, for its owner only', async () => {
    const db = await createTestDb()
    await seedSession(db, 10)

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { around_message_id: 'msg_5', window: 1 })
    const payload = JSON.parse(result.content) as {
      mode: string
      sessionId: string
      messages: Array<{ id: string }>
    }
    expect(payload.mode).toBe('scroll')
    expect(payload.sessionId).toBe('session_1')
    expect(payload.messages.map((m) => m.id)).toEqual(['msg_4', 'msg_5', 'msg_6'])

    const foreign = createHistorySearchTool(createChatRepository(db), 'user_2')
    const denied = await foreign.execute('tc_2', { around_message_id: 'msg_5' })
    expect(denied.content).toContain('No message with that id')
  })
})

describe('global_search history browse mode', () => {
  test('no args lists recent sessions with previews', async () => {
    const db = await createTestDb()
    for (const n of [1, 2, 3]) {
      await insertSession(db, { id: `session_${n}`, userId: 'user_1' })
      await insertMessage(db, {
        id: `msg_${n}_1`,
        sessionId: `session_${n}`,
        userId: 'user_1',
        sequence: 1,
        role: 'user',
        payloadJson: JSON.stringify({ role: 'user', content: `first message of session ${n}` }),
      })
    }

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', {})

    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content) as {
      mode: string
      sessions: Array<{ sessionId: string; preview: string; messageCount: number }>
    }
    expect(payload.mode).toBe('browse')
    expect(payload.sessions).toHaveLength(3)
    const s1 = payload.sessions.find((s) => s.sessionId === 'session_1')
    expect(s1?.preview).toContain('first message of session 1')
    expect(s1?.messageCount).toBe(1)
    expect((result.details as { mode: string; count: number }).mode).toBe('browse')
  })

  test('browse respects the limit and returns a clean empty message', async () => {
    const db = await createTestDb()
    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')

    const empty = await tool.execute('tc_1', {})
    expect(empty.content).toBe('No past sessions found.')

    for (let n = 1; n <= 5; n++) {
      await insertSession(db, { id: `session_${n}`, userId: 'user_1' })
      await insertMessage(db, {
        id: `msg_${n}`,
        sessionId: `session_${n}`,
        userId: 'user_1',
        sequence: 1,
        role: 'user',
        payloadJson: JSON.stringify({ role: 'user', content: `hello ${n}` }),
      })
    }
    const limited = await tool.execute('tc_2', { limit: 2 })
    const payload = JSON.parse(limited.content) as { sessions: unknown[] }
    expect(payload.sessions).toHaveLength(2)
  })
  /**
   * The two modes make DIFFERENT claims, and the difference is the whole reason the roles exist.
   * Discovery says "these sessions match"; scroll returns the messages themselves. Calling the
   * first one consulted is exactly what `docs/internals/subsystems/context-system.md` §9 rejects.
   */
  test('discovery publishes matched sessions as DISCOVERED, not consulted', async () => {
    const db = await createTestDb()
    await insertSession(db, { id: 'session_1', userId: 'user_1' })
    await insertMessage(db, {
      id: 'msg_1',
      sessionId: 'session_1',
      userId: 'user_1',
      sequence: 1,
      role: 'user',
      payloadJson: JSON.stringify({ role: 'user', content: 'How do I configure TypeScript?' }),
    })

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { query: 'TypeScript' })

    expect(result.sources).toHaveLength(1)
    expect(result.sources?.[0]).toMatchObject({ kind: 'session', role: 'discovered' })
    expect(result.sources?.[0]?.uri).toBe('localix://ui/work-item/chat?session=session_1')
  })

  test('scroll publishes the session as CONSULTED — it returned the messages', async () => {
    const db = await createTestDb()
    await insertSession(db, { id: 'session_1', userId: 'user_1' })
    await insertMessage(db, {
      id: 'msg_1',
      sessionId: 'session_1',
      userId: 'user_1',
      sequence: 1,
      role: 'user',
      payloadJson: JSON.stringify({ role: 'user', content: 'Some earlier work.' }),
    })

    const tool = createHistorySearchTool(createChatRepository(db), 'user_1')
    const result = await tool.execute('tc_1', { session_id: 'session_1' })

    expect(result.sources?.[0]).toMatchObject({
      kind: 'session',
      role: 'consulted',
      uri: 'localix://ui/work-item/chat?session=session_1',
    })
  })
})
