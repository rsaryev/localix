import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { serializeMessagePayload, type StoredMessagePayload } from '../../db/payload'
import { createUsageRepository } from './repository'
import { DEFAULT_AGENT_PARTICIPANT } from '../../db'

const tempDir = join(process.cwd(), 'tmp', 'usage-reconcile-tests')

describe('usage repository — assistant-message reconciliation', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('repairs only missing normal rows, preserving timestamps and existing events', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createUsageRepository(db)
    const createdAt = '2026-07-20T03:04:05.000Z'

    await db
      .insertInto('agent_sessions')
      .values([
        { id: 'session-1', user_id: 'user-1', project_id: 'PRJ-test', title: 'Usage' },
        { id: 'session-2', user_id: 'user-1', project_id: 'PRJ-test', title: 'Bare model' },
      ])
      .execute()
    // Repair falls back to the route of a session's first participant, so these rows are the
    // fixture's actual subject rather than scaffolding.
    await db
      .insertInto('conversation_participants')
      .values([
        {
          session_id: 'session-1',
          agent_id: 'builtin:localix',
          handle: 'localix',
          position: 0,
          model_id: 'new/model',
        },
        {
          session_id: 'session-2',
          agent_id: 'builtin:localix',
          handle: 'localix',
          position: 0,
          model_id: 'bare-model',
        },
      ])
      .execute()

    const payload = (value: StoredMessagePayload) => serializeMessagePayload(value)
    await db
      .insertInto('agent_messages')
      .values([
        {
          id: 'missing-turn',
          session_id: 'session-1',
          user_id: 'user-1',
          sequence: 0,
          role: 'assistant',
          payload_json: payload({
            id: 'missing-turn',
            role: 'assistant',
            from: DEFAULT_AGENT_PARTICIPANT,
            content: 'done',
            usage: {
              inputTokens: 80,
              outputTokens: 20,
              cachedInputTokens: 30,
              cacheWriteTokens: 5,
              reasoningTokens: 4,
              totalCost: 0.25,
              costSource: 'actual',
            },
            providerMeta: {
              providerId: 'old',
              providerName: 'Old Provider',
              modelId: 'model',
              keyLabel: 'primary',
              keyMasked: '…1234',
            },
            timing: {
              modelMs: 900,
              revealMs: 0,
              toolGenMs: 0,
              waitMs: 0,
              toolMs: 0,
              hitlMs: 0,
              idleMs: 0,
              totalMs: 900,
              turns: 1,
              tools: [],
            },
          }),
          created_at: createdAt,
          updated_at: createdAt,
        },
        {
          id: 'existing-turn',
          session_id: 'session-1',
          user_id: 'user-1',
          sequence: 1,
          role: 'assistant',
          payload_json: payload({
            id: 'existing-turn',
            role: 'assistant',
            from: DEFAULT_AGENT_PARTICIPANT,
            usage: { totalTokens: 999 },
          }),
          created_at: createdAt,
          updated_at: createdAt,
        },
        {
          id: 'no-usage',
          session_id: 'session-1',
          user_id: 'user-1',
          sequence: 2,
          role: 'assistant',
          payload_json: payload({
            id: 'no-usage',
            role: 'assistant',
            from: DEFAULT_AGENT_PARTICIPANT,
            content: 'synthetic',
          }),
          created_at: createdAt,
          updated_at: createdAt,
        },
        {
          id: 'bare-model-turn',
          session_id: 'session-2',
          user_id: 'user-1',
          sequence: 3,
          role: 'assistant',
          payload_json: payload({
            id: 'bare-model-turn',
            role: 'assistant',
            from: DEFAULT_AGENT_PARTICIPANT,
            usage: { inputTokens: 2, outputTokens: 1 },
          }),
          created_at: createdAt,
          updated_at: createdAt,
        },
        {
          id: 'corrupt-usage-turn',
          session_id: 'session-1',
          user_id: 'user-1',
          sequence: 4,
          role: 'assistant',
          payload_json: payload({
            id: 'corrupt-usage-turn',
            role: 'assistant',
            usage: { inputTokens: 'not-a-number', outputTokens: 1 },
          } as unknown as StoredMessagePayload),
          created_at: createdAt,
          updated_at: createdAt,
        },
        {
          id: 'aux-collision-turn',
          session_id: 'session-1',
          user_id: 'user-1',
          sequence: 5,
          role: 'assistant',
          payload_json: payload({
            id: 'aux-collision-turn',
            role: 'assistant',
            from: DEFAULT_AGENT_PARTICIPANT,
            usage: { totalTokens: 500 },
          }),
          created_at: createdAt,
          updated_at: createdAt,
        },
      ])
      .execute()

    await repo.recordEvent({
      messageId: 'existing-turn',
      sessionId: 'session-1',
      userId: 'user-1',
      modelId: 'recorded/model',
      totalTokens: 7,
      costSource: 'subscription',
      finishReason: 'end_turn',
      durationMs: 777,
      keyLabel: 'recorded-key',
    })
    await repo.accumulateEvent({
      messageId: 'aux-inline-completion:["session-1",null,"aux/model"]',
      sessionId: 'session-1',
      userId: 'user-1',
      modelId: 'aux/model',
      totalTokens: 11,
      finishReason: 'inline-completion',
    })
    await repo.accumulateEvent({
      messageId: 'aux-collision-turn',
      sessionId: 'session-1',
      userId: 'user-1',
      modelId: 'aux/model',
      totalTokens: 13,
      finishReason: 'inline-completion',
    })

    expect(await repo.reconcileAssistantMessageEvents()).toBe(3)
    expect(await repo.reconcileAssistantMessageEvents()).toBe(0)

    const rows = await db.selectFrom('usage_events').selectAll().orderBy('message_id').execute()
    expect(rows).toHaveLength(5)
    expect(rows.find((row) => row.message_id === 'missing-turn')).toMatchObject({
      session_id: 'session-1',
      root_session_id: 'session-1',
      user_id: 'user-1',
      provider_connection_id: null,
      provider_id: 'old',
      model_id: 'old/model',
      created_at: '2026-07-20 03:04:05',
      input_tokens: 80,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_write_tokens: 5,
      reasoning_tokens: 4,
      total_tokens: 100,
      cost_usd: 0.25,
      cost_source: 'actual',
      duration_ms: 900,
      key_label: 'primary',
      key_masked: '…1234',
    })
    expect(rows.find((row) => row.message_id === 'existing-turn')).toMatchObject({
      model_id: 'recorded/model',
      total_tokens: 999,
      cost_source: 'subscription',
      finish_reason: 'end_turn',
      duration_ms: 777,
      key_label: 'recorded-key',
    })
    expect(rows.find((row) => row.message_id === 'bare-model-turn')).toMatchObject({
      provider_id: null,
      model_id: 'bare-model',
      input_tokens: 2,
      output_tokens: 1,
      total_tokens: 3,
    })
    expect(
      rows.find((row) => row.message_id === 'aux-inline-completion:["session-1",null,"aux/model"]'),
    ).toMatchObject({ total_tokens: 11, model_id: 'aux/model' })
    expect(rows.find((row) => row.message_id === 'aux-collision-turn')).toMatchObject({
      total_tokens: 13,
      finish_reason: 'inline-completion',
      model_id: 'aux/model',
    })
    expect(rows.some((row) => row.message_id === 'no-usage')).toBe(false)
    expect(rows.some((row) => row.message_id === 'corrupt-usage-turn')).toBe(false)

    await destroyDatabase(db)
  })

  test('returns only the stale residue across a long history and is idle on the next boot', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createUsageRepository(db)
    await db
      .insertInto('agent_sessions')
      .values({
        project_id: 'PRJ-test',
        id: 'long-session',
        user_id: 'user-1',
        title: 'Long',
      })
      .execute()
    await db
      .insertInto('conversation_participants')
      .values({
        session_id: 'long-session',
        agent_id: 'builtin:localix',
        handle: 'localix',
        position: 0,
        model_id: 'model',
      })
      .execute()

    const messages = Array.from({ length: 1_000 }, (_, index) => ({
      id: `turn-${index.toString().padStart(4, '0')}`,
      session_id: 'long-session',
      user_id: 'user-1',
      sequence: index,
      role: 'assistant' as const,
      payload_json: serializeMessagePayload({
        id: `turn-${index.toString().padStart(4, '0')}`,
        role: 'assistant',
        from: DEFAULT_AGENT_PARTICIPANT,
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      }),
      created_at: '2026-07-20T03:04:05.000Z',
      updated_at: '2026-07-20T03:04:05.000Z',
    }))
    const events = messages.map((message) => ({
      message_id: message.id,
      session_id: 'long-session',
      root_session_id: 'long-session',
      user_id: 'user-1',
      provider_connection_id: null,
      provider_id: null,
      model_id: 'model',
      input_tokens: 2,
      output_tokens: 1,
      total_tokens: 3,
    }))
    for (let offset = 0; offset < messages.length; offset += 100) {
      await db
        .insertInto('agent_messages')
        .values(messages.slice(offset, offset + 100))
        .execute()
      await db
        .insertInto('usage_events')
        .values(events.slice(offset, offset + 100))
        .execute()
    }
    await db
      .updateTable('usage_events')
      .set({ input_tokens: 0, total_tokens: 1 })
      .where('message_id', '=', 'turn-0999')
      .execute()

    expect(await repo.reconcileAssistantMessageEvents()).toBe(1)
    expect(await repo.reconcileAssistantMessageEvents()).toBe(0)
    expect(
      await db
        .selectFrom('usage_events')
        .select(['input_tokens', 'total_tokens'])
        .where('message_id', '=', 'turn-0999')
        .executeTakeFirstOrThrow(),
    ).toEqual({ input_tokens: 2, total_tokens: 3 })

    await destroyDatabase(db)
  })
})
