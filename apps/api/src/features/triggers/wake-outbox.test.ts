import { afterEach, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createDatabaseWakeQueueStore } from '../chat/runtime/wake-queue-repository'
import { createWakeDelivery, type WakeAnswer, type WakeShape } from './delivery'
import { createWakeOutboxRepository } from './wake-outbox-repository'

const dbs: Array<ReturnType<typeof createDatabase>> = []
afterEach(async () => void (await Promise.all(dbs.splice(0).map((db) => db.destroy()))))

async function fixture() {
  const db = createDatabase()
  dbs.push(db)
  await migrateToLatest(db)
  return { db, outbox: createWakeOutboxRepository<WakeShape>(db) }
}

const wake = (key: string, extra: Partial<WakeShape> = {}): WakeShape => ({
  userId: 'u1',
  sessionId: 's1',
  content: 'fired',
  source: 'loop',
  deliveryKey: key,
  ...extra,
})

const quiet = { warn: () => {} }

describe('the wake outbox', () => {
  test('a wake lost with its process is redelivered at boot under its key', async () => {
    const { outbox } = await fixture()
    // The first process recorded the wake, then died before the queue took it.
    const dead = createWakeDelivery<WakeShape>({
      wake: () => new Promise<WakeAnswer>(() => {}),
      logger: quiet,
      outbox,
    })
    void dead.deliver(wake('trg:t1:3'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const sent: string[] = []
    const next = createWakeDelivery<WakeShape>({
      wake: async (request) => (sent.push(request.deliveryKey!), { delivered: true }),
      logger: quiet,
      outbox,
    })
    expect(await next.redeliver()).toBe(1)
    expect(sent).toEqual(['trg:t1:3'])
    // Delivered: nothing left for another boot.
    expect(await next.redeliver()).toBe(0)
  })

  test('a failed delivery stays for the next boot; a missed one does not', async () => {
    const { outbox } = await fixture()
    const failing = createWakeDelivery<WakeShape>({
      wake: async () => ({ delivered: false, missed: 'unreadable', detail: 'busy' }),
      logger: quiet,
      outbox,
    })
    await failing.deliver(wake('k-failed'))
    const missing = createWakeDelivery<WakeShape>({
      wake: async () => ({ delivered: false, missed: 'gone' }),
      logger: quiet,
      outbox,
    })
    await missing.deliver(wake('k-missed'))
    expect((await outbox.pending(Date.now())).map((r) => r.deliveryKey)).toEqual(['k-failed'])
  })

  test('a once-ever receipt delivery keeps its own recovery', async () => {
    const { outbox } = await fixture()
    const wakes = createWakeDelivery<WakeShape>({
      wake: () => new Promise<WakeAnswer>(() => {}),
      logger: quiet,
      outbox,
    })
    void wakes.deliver(wake('report:c1:r1', { receipt: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await outbox.pending(Date.now())).toEqual([])
  })

  test('the queue admitting the delivery removes it in the same transaction', async () => {
    const { db, outbox } = await fixture()
    await outbox.record(wake('trg:t1:4'), new Date().toISOString())
    // The queue's session foreign key is not what this pins.
    await sql`PRAGMA foreign_keys = OFF`.execute(db)
    const store = createDatabaseWakeQueueStore<{ content: string }>(db)
    await store.enqueue({
      id: 'trg:t1:4',
      userId: 'u1',
      sessionId: 's1',
      priority: 0,
      kind: 'wake',
      payload: { content: 'fired' },
      deliveryKey: 'trg:t1:4',
      queuedAt: new Date().toISOString(),
    })
    expect(await db.selectFrom('agent_queue_items').select('id').execute()).toEqual([
      { id: 'trg:t1:4' },
    ])
    expect(await outbox.pending(Date.now())).toEqual([])
  })

  test('rows past the horizon are given up', async () => {
    const { outbox } = await fixture()
    await outbox.record(wake('old'), new Date(Date.now() - 2 * 86_400_000).toISOString())
    expect(await outbox.pending(Date.now())).toEqual([])
  })
})
