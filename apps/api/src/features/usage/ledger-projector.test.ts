import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from '../changes/core-entities'
import { createUsageLedgerProjector } from './ledger-projector'
import { createUsageRepository } from './repository'

const turnEnd = {
  finishReason: 'stop',
  keyId: 'k1',
  keyLabel: 'work',
  providerId: 'openrouter',
  modelId: 'openrouter/deepseek/deepseek-chat',
  providerConnectionId: 'or-1',
}

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ id: 's1', user_id: 'u1', title: 's1', project_id: 'p1' })
    .execute()
  const message = (id: string, usage: Record<string, number>, sequence = 1) =>
    db
      .insertInto('agent_messages')
      .values({
        id,
        session_id: 's1',
        user_id: 'u1',
        sequence,
        role: 'assistant',
        payload_json: JSON.stringify({ id, role: 'assistant', content: 'x', usage, turnEnd }),
      })
      .execute()
  const rows = () =>
    db
      .selectFrom('usage_events')
      .select([
        'message_id',
        'input_tokens',
        'cache_write_1h_tokens',
        'finish_reason',
        'key_id',
        'key_label',
        'model_id',
        'provider_connection_id',
      ])
      .orderBy('message_id')
      .execute()
  const projector = createUsageLedgerProjector({ usage: createUsageRepository(db) })
  return { db, message, rows, projector }
}

const ref = (id: string) => ({ id, userId: 'u1', sessionId: 's1' })

describe('usage ledger projector', () => {
  test('a message notice writes its turn’s row; a duplicate rewrites the same row', async () => {
    const t = await setup()
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('usage-ledger', t.projector.handlers, { kind: 'projector' })
    await t.message('m1', {
      inputTokens: 10,
      outputTokens: 2,
      cacheWriteTokens: 8,
      cacheWrite1hTokens: 6,
    })
    const notice = { entity: 'chat.message' as const, op: 'upserted' as const, ref: ref('m1') }
    await recordCoreChanges(t.db, [notice, notice])
    await feed.settle()
    expect(await t.rows()).toEqual([
      {
        message_id: 'm1',
        input_tokens: 10,
        cache_write_1h_tokens: 6,
        finish_reason: 'stop',
        key_id: 'k1',
        key_label: 'work',
        model_id: 'openrouter/deepseek/deepseek-chat',
        provider_connection_id: 'or-1',
      },
    ])
    // The next turn's usage moves the same message: its row follows.
    await t.db
      .updateTable('agent_messages')
      .set({
        payload_json: JSON.stringify({
          id: 'm1',
          role: 'assistant',
          usage: { inputTokens: 30 },
          turnEnd,
        }),
      })
      .execute()
    await recordCoreChanges(t.db, notice)
    await feed.settle()
    expect((await t.rows())[0]?.input_tokens).toBe(30)
    await feed.close()
  })

  test('a gap is closed by the reconcile; a run’s end rewrites its chat’s rows', async () => {
    const t = await setup()
    // Written while nothing listened: no notice reaches the projector.
    await t.message('m1', { inputTokens: 5 })
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('usage-ledger', t.projector.handlers, {
      kind: 'projector',
      reconcile: t.projector.reconcile,
    })
    await feed.settle()
    expect((await t.rows()).map((r) => r.message_id)).toEqual(['m1'])
    await t.message('m2', { inputTokens: 7 }, 2)
    await recordCoreChanges(t.db, {
      entity: 'chat.session',
      op: 'upserted',
      ref: { id: 's1', userId: 'u1' },
    })
    await feed.settle()
    expect((await t.rows()).map((r) => r.message_id)).toEqual(['m1', 'm2'])
    await feed.close()
  })

  test('a chat’s deletion keeps the spend it already recorded', async () => {
    const t = await setup()
    await t.message('m1', { inputTokens: 5 })
    await createUsageRepository(t.db).projectMessages({ messageIds: ['m1'] })
    const handler = t.projector.handlers['chat.message']
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({
      entity: 'chat.message',
      op: 'parent-deleted',
      parent: { entity: 'chat.session', op: 'deleted', ref: { id: 's1', userId: 'u1' } },
    })
    expect((await t.rows()).length).toBe(1)
  })
})
