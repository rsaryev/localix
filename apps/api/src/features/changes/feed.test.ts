import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { Delivery } from './contracts'
import { createChangeFeed } from './feed'
import { setChangeLog } from './record'

const refs = {
  chat: z.object({ id: z.string() }),
  message: z.object({ id: z.string(), chatId: z.string() }),
  note: z.object({ id: z.string() }),
}
const cascades = { chat: ['message'] } as const
type Seen = Delivery<typeof refs, typeof cascades, keyof typeof refs>

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const logged: string[] = []
  const feed = createChangeFeed({
    db,
    stream: 'test',
    registry: { refs, cascades },
    log: (event) => logged.push(event),
  })
  return { db, feed, logged }
}

describe('change feed', () => {
  test('a change recorded in a transaction reaches the consumer once it committed', async () => {
    const { db, feed } = await setup()
    const seen: Seen[] = []
    const consumer = await feed.subscribe('index', {
      chat: (d) => void seen.push(d),
      message: (d) => void seen.push(d),
      note: 'ignore',
    })
    await consumer.settle()
    await db.transaction().execute(async (trx) => {
      await feed.record(trx, { entity: 'message', op: 'upserted', ref: { id: 'm1', chatId: 'c1' } })
      await feed.record(trx, { entity: 'note', op: 'upserted', ref: { id: 'n1' } })
    })
    await feed.settle()
    expect(seen).toEqual([{ entity: 'message', op: 'upserted', ref: { id: 'm1', chatId: 'c1' } }])
    await feed.close()
  })

  test('a parent deletion also reaches the consumers of its children', async () => {
    const { db, feed } = await setup()
    const messages: Seen[] = []
    await feed.subscribe('index', {
      chat: 'ignore',
      message: (d) => void messages.push(d),
      note: 'ignore',
    })
    await feed.record(db, { entity: 'chat', op: 'deleted', ref: { id: 'c1' } })
    await feed.settle()
    expect(messages).toEqual([
      {
        entity: 'message',
        op: 'parent-deleted',
        parent: { entity: 'chat', op: 'deleted', ref: { id: 'c1' } },
      },
    ])
    await feed.close()
  })

  test('a failing consumer keeps its place and is retried; others are unaffected', async () => {
    const { feed, logged } = await setup()
    let fails = 1
    const flaky: string[] = []
    const steady: string[] = []
    const a = await feed.subscribe('flaky', {
      chat: 'ignore',
      message: 'ignore',
      note: (d) => {
        if (fails-- > 0) throw new Error('index busy')
        if (d.op === 'upserted') flaky.push(d.ref.id)
      },
    })
    await feed.subscribe('steady', {
      chat: 'ignore',
      message: 'ignore',
      note: (d) => void (d.op === 'upserted' && steady.push(d.ref.id)),
    })
    feed.publish({ entity: 'note', op: 'upserted', ref: { id: 'n1' } })
    await feed.settle()
    expect(steady).toEqual(['n1'])
    expect(flaky).toEqual([])
    expect(logged).toContain('changes.consumer_failed')
    await a.settle()
    expect(flaky).toEqual(['n1'])
    await feed.close()
  })

  test('recording never throws into the producer, and its write still commits', async () => {
    const { db, feed } = await setup()
    const logged: string[] = []
    setChangeLog((event) => logged.push(event))
    await db.transaction().execute(async (trx) => {
      await feed.record(trx, { entity: 'note', op: 'upserted', ref: { id: 'n1' } })
      await trx.schema.dropTable('change_events').execute()
      await feed.record(trx, { entity: 'note', op: 'upserted', ref: { id: 'n2' } })
    })
    expect(logged).toContain('changes.record_failed')
    await feed.close()
  })

  test('a malformed row is skipped, and the consumer goes on', async () => {
    const { db, feed } = await setup()
    const seen: string[] = []
    await feed.subscribe('index', {
      chat: 'ignore',
      message: 'ignore',
      note: (d) => void (d.op === 'upserted' && seen.push(d.ref.id)),
    })
    await db
      .insertInto('change_events')
      .values([
        { stream: 'test', entity: 'note', op: 'upserted', ref_json: '{"wrong":1}' },
        { stream: 'test', entity: 'note', op: 'upserted', ref_json: '{"id":"n2"}' },
      ])
      .execute()
    await feed.settle()
    expect(seen).toEqual(['n2'])
    await feed.close()
  })

  test('notices every consumer has read are pruned once old enough', async () => {
    const { db, feed } = await setup()
    await feed.subscribe('index', { chat: 'ignore', message: 'ignore', note: 'ignore' })
    feed.publish({ entity: 'note', op: 'upserted', ref: { id: 'n1' } })
    await feed.settle()
    expect(await feed.prune()).toBe(0)
    expect(await feed.prune(Date.now() + 2 * 24 * 60 * 60_000)).toBe(1)
    expect(await db.selectFrom('change_events').selectAll().execute()).toEqual([])
    await feed.close()
  })
})
