import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createChangeFeed } from './feed'
import { createFeedTestbed } from './testing'

const refs = { note: z.object({ id: z.string() }) }
const registry = { refs, cascades: {} }
type NoteChange = { entity: 'note'; op: 'upserted'; ref: { id: string } }
const note = (id: string): NoteChange => ({ entity: 'note', op: 'upserted', ref: { id } })
const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `n${from + i}`)

/** A handler that collects upserted ids. */
const collect = (into: string[]) => (d: { op: string; ref?: { id: string } }) =>
  void (d.op === 'upserted' && d.ref && into.push(d.ref.id))

const failingTimes = (times: number, into: string[]) => {
  let left = times
  return (d: { op: string; ref?: { id: string } }) => {
    if (left-- > 0) throw new Error('index busy')
    collect(into)(d)
  }
}

describe('where a consumer starts', () => {
  test('a new consumer starts past what was recorded before it, by default', async () => {
    const { feed } = await createFeedTestbed(registry)
    feed.publish(note('before'))
    await feed.settle()
    const seen: string[] = []
    const consumer = await feed.subscribe('index', { note: collect(seen) }, { kind: 'projector' })
    feed.publish(note('after'))
    await consumer.settle()
    expect(seen).toEqual(['after'])
    await feed.close()
  })

  test('`from: start` reads what was recorded before it', async () => {
    const { feed } = await createFeedTestbed(registry)
    feed.publish(note('before'))
    await feed.settle()
    const seen: string[] = []
    const consumer = await feed.subscribe(
      'index',
      { note: collect(seen) },
      { kind: 'projector', from: 'start' },
    )
    await consumer.settle()
    expect(seen).toEqual(['before'])
    await feed.close()
  })

  test('a restarted consumer resumes at its stored cursor, not at the head', async () => {
    const { db, feed } = await createFeedTestbed(registry)
    const first: string[] = []
    const consumer = await feed.subscribe('index', { note: collect(first) }, { kind: 'reactor' })
    feed.publish(note('n1'))
    await consumer.settle()
    await feed.close()

    // Recorded while the consumer was down.
    const offline = createChangeFeed({ db, stream: 'test', registry, retryDelayMs: () => 0 })
    offline.publish(note('n2'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await offline.close()

    const restarted = createChangeFeed({
      db,
      stream: 'test',
      registry,
      retryDelayMs: () => 60 * 60_000,
    })
    const second: string[] = []
    const again = await restarted.subscribe('index', { note: collect(second) }, { kind: 'reactor' })
    await again.settle()
    expect(first).toEqual(['n1'])
    expect(second).toEqual(['n2'])
    await restarted.close()
  })

  test('the same name cannot be subscribed twice on one feed', async () => {
    const { feed } = await createFeedTestbed(registry)
    await feed.subscribe('index', { note: 'ignore' }, { kind: 'reactor' })
    expect(feed.subscribe('index', { note: 'ignore' }, { kind: 'reactor' })).rejects.toThrow(
      'already subscribed',
    )
    await feed.close()
  })
})

describe('reading', () => {
  test('reads more than one page, in recorded order', async () => {
    const { feed } = await createFeedTestbed(registry)
    const seen: string[] = []
    const consumer = await feed.subscribe('index', { note: collect(seen) }, { kind: 'projector' })
    feed.publish(ids(250).map(note))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await consumer.settle()
    expect(seen).toEqual(ids(250))
    expect(consumer.position()).toBe(250)
    await feed.close()
  })

  test('streams are isolated: a consumer never sees another stream', async () => {
    const { db, feed } = await createFeedTestbed(registry, 'core')
    const other = createChangeFeed({ db, stream: 'mini-app:x', registry, retryDelayMs: () => 0 })
    const seen: string[] = []
    const consumer = await feed.subscribe('index', { note: collect(seen) }, { kind: 'reactor' })
    other.publish(note('elsewhere'))
    feed.publish(note('here'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await consumer.settle()
    expect(seen).toEqual(['here'])
    await other.close()
    await feed.close()
  })

  test('two consumers keep independent cursors', async () => {
    const { feed } = await createFeedTestbed(registry)
    const a: string[] = []
    const b: string[] = []
    const first = await feed.subscribe('a', { note: collect(a) }, { kind: 'reactor' })
    feed.publish(note('n1'))
    await first.settle()
    const second = await feed.subscribe('b', { note: collect(b) }, { kind: 'reactor' })
    feed.publish(note('n2'))
    await feed.settle()
    expect(a).toEqual(['n1', 'n2'])
    expect(b).toEqual(['n2'])
    await feed.close()
    expect(second.position()).toBe(2)
  })

  test('a stopped consumer reads nothing more', async () => {
    const { feed } = await createFeedTestbed(registry)
    const seen: string[] = []
    const consumer = await feed.subscribe('index', { note: collect(seen) }, { kind: 'reactor' })
    await consumer.stop()
    feed.publish(note('n1'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await consumer.settle()
    expect(seen).toEqual([])
    await feed.close()
  })
})

describe('failures', () => {
  test('a failing handler holds the cursor and succeeds on the next attempt', async () => {
    const { feed, logged } = await createFeedTestbed(registry)
    const seen: string[] = []
    const consumer = await feed.subscribe(
      'index',
      { note: failingTimes(2, seen) },
      { kind: 'projector' },
    )
    feed.publish(note('n1'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await consumer.settle()
    expect(consumer.position()).toBe(0)
    expect((await consumer.health()).attempts).toBe(1)
    await consumer.settle()
    await consumer.settle()
    expect(seen).toEqual(['n1'])
    expect(consumer.position()).toBe(1)
    expect((await consumer.health()).attempts).toBe(0)
    expect(logged.filter((event) => event === 'changes.consumer_failed')).toHaveLength(2)
    await feed.close()
  })

  test('after every attempt fails the notice becomes a dead letter and reading goes on', async () => {
    const { feed, logged } = await createFeedTestbed(registry)
    const seen: string[] = []
    const handler = (d: { op: string; ref?: { id: string } }) => {
      if (d.ref?.id === 'poison') throw new Error('cannot index')
      collect(seen)(d)
    }
    const consumer = await feed.subscribe('index', { note: handler }, { kind: 'projector' })
    feed.publish([note('poison'), note('n2')])
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let attempt = 0; attempt < 5; attempt += 1) await consumer.settle()
    expect(seen).toEqual(['n2'])
    expect(consumer.position()).toBe(2)
    expect(logged).toContain('changes.consumer_skipped')
    const letters = await consumer.deadLetters()
    expect(letters).toHaveLength(1)
    expect(letters[0]).toMatchObject({ seq: 1, entity: 'note', error: 'cannot index' })
    expect(await consumer.health()).toMatchObject({
      deadLetters: 1,
      attempts: 0,
      lastError: { message: 'cannot index', seq: 1 },
    })
    await feed.close()
  })

  test('replaying dead letters delivers them again and removes the ones that pass', async () => {
    const { feed } = await createFeedTestbed(registry)
    let broken = true
    const seen: string[] = []
    const handler = (d: { op: string; ref?: { id: string } }) => {
      if (broken && d.ref?.id.startsWith('bad')) throw new Error('broken')
      collect(seen)(d)
    }
    const consumer = await feed.subscribe('index', { note: handler }, { kind: 'reactor' })
    feed.publish([note('bad1'), note('bad2')])
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let attempt = 0; attempt < 10; attempt += 1) await consumer.settle()
    expect((await consumer.deadLetters()).map((letter) => letter.seq)).toEqual([1, 2])

    broken = false
    expect(await consumer.replayDeadLetters()).toEqual({ replayed: 2, remaining: 0 })
    expect(seen).toEqual(['bad1', 'bad2'])
    await feed.close()
  })

  test('a replay stops at the first letter that still fails, keeping it and the rest', async () => {
    const { feed } = await createFeedTestbed(registry)
    const consumer = await feed.subscribe(
      'index',
      {
        note: () => {
          throw new Error('still broken')
        },
      },
      { kind: 'reactor' },
    )
    feed.publish([note('a'), note('b')])
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let attempt = 0; attempt < 10; attempt += 1) await consumer.settle()
    expect(await consumer.replayDeadLetters()).toEqual({ replayed: 0, remaining: 2 })
    await feed.close()
  })

  test('a malformed row is skipped without failing the consumer', async () => {
    const { db, feed } = await createFeedTestbed(registry)
    const seen: string[] = []
    const consumer = await feed.subscribe('index', { note: collect(seen) }, { kind: 'reactor' })
    await db
      .insertInto('change_events')
      .values([
        { stream: 'test', entity: 'note', op: 'upserted', ref_json: '{not json' },
        { stream: 'test', entity: 'note', op: 'upserted', ref_json: '{"id":"n2"}' },
      ])
      .execute()
    await consumer.settle()
    expect(seen).toEqual(['n2'])
    expect(await consumer.deadLetters()).toEqual([])
    await feed.close()
  })
})
