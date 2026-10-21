import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { Delivery } from './contracts'
import { createChangeFeed } from './feed'
import { createFeedTestbed } from './testing'

const refs = {
  chat: z.object({ id: z.string() }),
  message: z.object({ id: z.string(), chatId: z.string() }),
  note: z.object({ id: z.string() }),
}
const cascades = { chat: ['message'] } as const
type Seen = Delivery<typeof refs, typeof cascades, keyof typeof refs>
type NoteDelivery = Delivery<typeof refs, typeof cascades, 'note'>
const setup = () => createFeedTestbed({ refs, cascades })
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const DAY = 24 * 60 * 60_000
const quiet = { chat: 'ignore', message: 'ignore', note: 'ignore' } as const
const note = (id: string) => ({ entity: 'note' as const, op: 'upserted' as const, ref: { id } })
const notesInto = (into: string[]) => ({
  chat: 'ignore' as const,
  message: 'ignore' as const,
  note: (d: NoteDelivery) => void (d.op === 'upserted' && into.push(d.ref.id)),
})
const failing = (message: string) => ({
  chat: 'ignore' as const,
  message: 'ignore' as const,
  note: () => {
    throw new Error(message)
  },
})

describe('delivery through the feed', () => {
  test('a change recorded in a transaction reaches the consumer once it committed', async () => {
    const { db, feed } = await setup()
    const seen: Seen[] = []
    await feed.subscribe(
      'index',
      { chat: (d) => void seen.push(d), message: (d) => void seen.push(d), note: 'ignore' },
      { kind: 'projector' },
    )
    await db.transaction().execute(async (trx) => {
      await feed.record(trx, {
        entity: 'message',
        op: 'upserted',
        ref: { id: 'm1', chatId: 'c1' },
      })
      await feed.record(trx, note('n1'))
    })
    await feed.settle()
    expect(seen).toEqual([{ entity: 'message', op: 'upserted', ref: { id: 'm1', chatId: 'c1' } }])
    await feed.close()
  })

  test('a parent deletion also reaches the consumers of its children', async () => {
    const { db, feed } = await setup()
    const messages: Seen[] = []
    await feed.subscribe(
      'index',
      { chat: 'ignore', message: (d) => void messages.push(d), note: 'ignore' },
      { kind: 'projector' },
    )
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

  test('a failing consumer does not hold back the others', async () => {
    const { feed } = await setup()
    const steady: string[] = []
    await feed.subscribe('flaky', failing('busy'), { kind: 'reactor' })
    await feed.subscribe('steady', notesInto(steady), { kind: 'reactor' })
    feed.publish(note('n1'))
    await feed.settle()
    expect(steady).toEqual(['n1'])
    await feed.close()
  })
})

describe('reconcile', () => {
  test('a new consumer reconciles once, before reading; a known one does not', async () => {
    const { db, feed } = await setup()
    let reconciled = 0
    const options = { kind: 'projector' as const, reconcile: () => void (reconciled += 1) }
    const consumer = await feed.subscribe('index', quiet, options)
    await consumer.settle()
    expect(reconciled).toBe(1)
    await feed.close()

    const again = createChangeFeed({
      db,
      stream: 'test',
      registry: { refs, cascades },
      retryDelayMs: () => 60 * 60_000,
    })
    const restarted = await again.subscribe('index', quiet, options)
    await restarted.settle()
    expect(reconciled).toBe(1)
    await again.close()
  })

  test('a notice given up on makes the consumer reconcile', async () => {
    const { feed } = await setup()
    let reconciled = 0
    const consumer = await feed.subscribe('index', failing('broken'), {
      kind: 'reactor',
      reconcile: () => void (reconciled += 1),
    })
    await consumer.settle()
    expect(reconciled).toBe(1)
    feed.publish(note('n1'))
    await tick()
    for (let attempt = 0; attempt < 5; attempt += 1) await consumer.settle()
    await consumer.settle()
    expect(reconciled).toBe(2)
    await feed.close()
  })

  test('a failing reconcile is retried, and notices wait for it', async () => {
    const { feed, logged } = await setup()
    let failures = 1
    const seen: string[] = []
    const consumer = await feed.subscribe('index', notesInto(seen), {
      kind: 'projector',
      from: 'start',
      reconcile: () => {
        if (failures-- > 0) throw new Error('owner unavailable')
      },
    })
    feed.publish(note('n1'))
    await tick()
    await consumer.settle()
    expect(seen).toEqual([])
    expect(logged).toContain('changes.reconcile_failed')
    expect((await consumer.health()).lastError?.message).toBe('owner unavailable')
    await consumer.settle()
    expect(seen).toEqual(['n1'])
    await feed.close()
  })
})

describe('rebuild', () => {
  test('a projector rebuild resets, jumps to the head, reconciles, then reads what follows', async () => {
    const { feed } = await setup()
    const steps: string[] = []
    const consumer = await feed.subscribe(
      'index',
      {
        chat: 'ignore',
        message: 'ignore',
        note: (d) => void (d.op === 'upserted' && steps.push(`note:${d.ref.id}`)),
      },
      {
        kind: 'projector',
        reset: () => void steps.push('reset'),
        reconcile: () => void steps.push('reconcile'),
      },
    )
    await consumer.settle()
    feed.publish(note('old'))
    await feed.settle()
    steps.length = 0

    await consumer.rebuild()
    expect(steps).toEqual(['reset', 'reconcile'])
    expect(consumer.position()).toBe(1)
    feed.publish(note('new'))
    await feed.settle()
    expect(steps).toEqual(['reset', 'reconcile', 'note:new'])
    await feed.close()
  })

  test('only a projector with reset and reconcile can be rebuilt', async () => {
    const { feed } = await setup()
    const reactor = await feed.subscribe('r', quiet, { kind: 'reactor', reconcile: () => {} })
    const bare = await feed.subscribe('p', quiet, { kind: 'projector' })
    expect(reactor.rebuild()).rejects.toThrow('not a projector')
    expect(bare.rebuild()).rejects.toThrow('needs reset and reconcile')
    await feed.close()
  })
})

describe('health', () => {
  test('reports each consumer with its lag behind the newest notice', async () => {
    const { feed } = await setup()
    const fast = await feed.subscribe('fast', quiet, { kind: 'projector' })
    feed.publish([note('n1'), note('n2'), note('n3')])
    await tick()
    await fast.settle()
    const slow = await feed.subscribe('slow', quiet, { kind: 'reactor', from: 'start' })
    const health = await feed.health()
    expect(health.find((h) => h.name === 'fast')).toMatchObject({
      kind: 'projector',
      position: 3,
      lag: 0,
    })
    expect(health.find((h) => h.name === 'slow')).toMatchObject({
      kind: 'reactor',
      position: 0,
      lag: 3,
    })
    await slow.settle()
    expect((await feed.health()).every((h) => h.lag === 0)).toBe(true)
    await feed.close()
  })
})

describe('retention', () => {
  test('notices every consumer has read are pruned once old enough', async () => {
    const { db, feed } = await setup()
    await feed.subscribe('index', quiet, { kind: 'reactor' })
    feed.publish(note('n1'))
    await feed.settle()
    expect(await feed.prune()).toBe(0)
    expect(await feed.prune(Date.now() + 2 * DAY)).toBe(1)
    expect(await db.selectFrom('change_events').selectAll().execute()).toEqual([])
    await feed.close()
  })

  test('a notice a stopped consumer has not read is kept, however old', async () => {
    const { feed } = await setup()
    await feed.subscribe('fast', quiet, { kind: 'reactor' })
    const slow = await feed.subscribe('slow', quiet, { kind: 'reactor' })
    await slow.stop()
    feed.publish(note('n1'))
    await feed.settle()
    expect(await feed.prune(Date.now() + 2 * DAY)).toBe(0)
    await feed.close()
  })

  test('a consumer gone for a month loses its cursor and dead letters; a running one keeps them', async () => {
    const { db, feed } = await setup()
    const old = new Date(Date.now() - 40 * DAY).toISOString()
    await db
      .insertInto('change_cursors')
      .values([
        { consumer: 'gone', stream: 'test', seq: 0, updated_at: old },
        { consumer: 'running', stream: 'test', seq: 0, updated_at: old },
      ])
      .execute()
    await db
      .insertInto('change_dead_letters')
      .values({
        consumer: 'gone',
        stream: 'test',
        seq: 1,
        entity: 'note',
        op: 'upserted',
        ref_json: null,
        error: 'x',
        failed_at: old,
      })
      .execute()
    await feed.subscribe('running', quiet, { kind: 'reactor' })
    await feed.prune()
    const cursors = await db.selectFrom('change_cursors').select('consumer').execute()
    expect(cursors.map((c) => c.consumer)).toEqual(['running'])
    expect(await db.selectFrom('change_dead_letters').selectAll().execute()).toEqual([])
    await feed.close()
  })
})
