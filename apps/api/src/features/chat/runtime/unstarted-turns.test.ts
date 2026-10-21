import { afterEach, describe, expect, test } from 'bun:test'

import { createDatabase } from '../../../db/connection'
import type { PersistedMessage } from '../contracts'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import type { PendingTurnStart, TurnStartRepository } from './turn-start-repository'
import { settleUnstartedTurns, TURN_NOT_STARTED_NOTICE } from './unstarted-turns'
import { createDatabaseWakeQueueStore } from './wake-queue-repository'

const start = (id: string): PendingTurnStart => ({
  assistantMessageId: id,
  userId: 'u',
  sessionId: 's',
  agentId: 'a1',
  createdAt: '2026-10-21T10:00:00.000Z',
})

const reply = (id: string, content = ''): PersistedMessage =>
  ({
    id,
    sessionId: 's',
    userId: 'u',
    payload: { id, role: 'assistant', content, from: 'agent:a1' },
  }) as unknown as PersistedMessage

function harness(pending: PendingTurnStart[], history: PersistedMessage[], started = false) {
  const records = new Map(pending.map((p) => [p.assistantMessageId, p]))
  const messages = new Map(history.map((m) => [m.id, m]))
  const turnStarts: TurnStartRepository = {
    listPending: async () => [...records.values()],
    runStartedSince: async () => started,
    settle: async (id) => void records.delete(id),
  }
  const repo = {
    listMessages: async () => [...messages.values()],
    getMessage: async (_u: string, _s: string, id: string) => messages.get(id) ?? null,
    insertMessage: async (message: PersistedMessage) => void messages.set(message.id, message),
    deleteMessagesByIds: async (_u: string, _s: string, ids: string[]) =>
      ids.forEach((id) => messages.delete(id)),
  } as unknown as ChatRepository
  const deps = {
    turnStarts,
    repo,
    streamRegistry: { publish: () => {} } as unknown as SessionStreamRegistry,
    now: () => '2026-10-21T10:05:00.000Z',
  }
  return { records, messages, run: () => settleUnstartedTurns(deps) }
}

describe('turns acknowledged before their run existed', () => {
  test('an empty placeholder is replaced by a notice with a retry, once', async () => {
    const t = harness([start('m1')], [reply('m1')])
    expect(await t.run()).toBe(1)
    expect(t.messages.has('m1')).toBeFalse()
    const notice = t.messages.get('unstarted-m1')!
    expect(notice.payload.content).toBe(TURN_NOT_STARTED_NOTICE)
    expect(notice.payload.systemNotice?.recovery).toEqual(['retry'])
    expect(t.records.size).toBe(0)
    // A second boot finds nothing left to settle.
    expect(await t.run()).toBe(0)
  })

  test('a slot whose run started is left to the interrupted-run sweep', async () => {
    const t = harness([start('m1')], [reply('m1')], true)
    expect(await t.run()).toBe(0)
    expect(t.messages.has('m1')).toBeTrue()
    expect(t.records.size).toBe(0)
  })

  test('a reply that was written is kept', async () => {
    const t = harness([start('m1')], [reply('m1', 'done')])
    expect(await t.run()).toBe(0)
    expect(t.messages.get('m1')!.payload.content).toBe('done')
    expect(t.records.size).toBe(0)
  })
})

describe('the acknowledgement records the slot', () => {
  const dbs: Array<ReturnType<typeof createDatabase>> = []
  afterEach(async () => void (await Promise.all(dbs.splice(0).map((db) => db.destroy()))))

  test('in the ack transaction, and the returned run clears it', async () => {
    const db = createDatabase()
    dbs.push(db)
    await db.schema
      .createTable('agent_queue_items')
      .addColumn('sequence', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('id', 'text', (c) => c.notNull().unique())
      .addColumn('user_id', 'text', (c) => c.notNull())
      .addColumn('session_id', 'text', (c) => c.notNull())
      .addColumn('priority', 'integer', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('payload_json', 'text', (c) => c.notNull())
      .addColumn('state', 'text', (c) => c.notNull().defaultTo('pending'))
      .addColumn('lease_owner', 'text')
      .addColumn('lease_expires_at', 'text')
      .addColumn('delivery_key', 'text', (c) => c.notNull().unique())
      .addColumn('queued_at', 'text', (c) => c.notNull())
      .addColumn('batch_id', 'text')
      .execute()
    await db.schema
      .createTable('agent_turn_starts')
      .addColumn('assistant_message_id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', (c) => c.notNull())
      .addColumn('session_id', 'text', (c) => c.notNull())
      .addColumn('agent_id', 'text', (c) => c.notNull())
      .addColumn('created_at', 'text', (c) => c.notNull())
      .execute()
    await db.schema
      .createTable('wake_outbox')
      .addColumn('delivery_key', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', (c) => c.notNull())
      .addColumn('session_id', 'text', (c) => c.notNull())
      .addColumn('request_json', 'text', (c) => c.notNull())
      .addColumn('created_at', 'text', (c) => c.notNull())
      .execute()
    const store = createDatabaseWakeQueueStore<{ content: string }>(db)
    await store.enqueue({
      id: 't1',
      userId: 'u',
      sessionId: 's',
      priority: 0,
      kind: 'wake',
      payload: { content: 'x' },
      deliveryKey: 'k1',
      queuedAt: '2026-10-21T10:00:00.000Z',
    })
    const at = '2026-10-21T10:00:00.000Z'
    expect(await store.claim('u', 's', ['t1'], 'o', at, '2026-10-21T10:01:00.000Z')).toBeTrue()
    expect(
      await store.ack('u', 's', ['t1'], 'o', { assistantMessageId: 'm1', agentId: 'a1', at }),
    ).toBeTrue()
    const slots = () => db.selectFrom('agent_turn_starts').select('assistant_message_id').execute()
    expect(await slots()).toEqual([{ assistant_message_id: 'm1' }])
    await store.turnStarted!('m1')
    expect(await slots()).toEqual([])
  })
})
