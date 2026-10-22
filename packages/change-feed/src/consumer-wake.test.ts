import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ConsumerTimers } from './consumer'
import { createChangeFeed } from './feed'
import { createTestDatabase } from './testing'

const registry = { refs: { note: z.object({ id: z.string() }) }, cascades: {} }
const note = (id: string) => ({ entity: 'note' as const, op: 'upserted' as const, ref: { id } })

/** Timers the test fires by hand: what is armed, and for how long, is the evidence. */
function manualTimers() {
  const armed = new Map<number, { run: () => void; ms: number }>()
  let next = 0
  const timers: ConsumerTimers = {
    set: (run, ms) => {
      armed.set(++next, { run, ms })
      return next
    },
    clear: (handle) => void armed.delete(handle as number),
  }
  /** Fire everything armed now (not what those runs arm in turn). */
  const fire = () => {
    const due = [...armed.entries()]
    armed.clear()
    for (const [, timer] of due) timer.run()
  }
  return { timers, armed, fire }
}

/** Let queued database work and callbacks run, without a clock. */
const drain = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

const deferred = () => {
  let release = () => {}
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

async function testbed() {
  const db = await createTestDatabase()
  const clock = manualTimers()
  const feed = createChangeFeed({
    db,
    stream: 'test',
    registry,
    retryDelayMs: () => 60 * 60_000,
    timers: clock.timers,
  })
  return { feed, ...clock }
}

describe('a consumer is woken by writes, never by a clock', () => {
  test('a caught-up consumer arms no timer', async () => {
    const { feed, armed, fire } = await testbed()
    const seen: string[] = []
    const consumer = await feed.subscribe(
      'index',
      { note: (d) => void (d.op === 'upserted' && seen.push(d.ref.id)) },
      { kind: 'projector' },
    )
    fire()
    await consumer.settle()
    expect(armed.size).toBe(0)

    feed.publish(note('n1'))
    await new Promise((resolve) => setImmediate(resolve))
    // The write's signal armed the short wake, and nothing else.
    expect([...armed.values()].map((timer) => timer.ms)).toEqual([50])
    fire()
    await consumer.settle()
    expect(seen).toEqual(['n1'])
    expect(armed.size).toBe(0)
    await feed.close()
  })

  test('a wake that lands while a run is in hand reads again right after it', async () => {
    const { feed, armed, fire } = await testbed()
    const seen: string[] = []
    const gate = deferred()
    const consumer = await feed.subscribe(
      'index',
      {
        note: async (d) => {
          if (d.op !== 'upserted') return
          if (d.ref.id === 'n1') await gate.promise
          seen.push(d.ref.id)
        },
      },
      { kind: 'projector' },
    )
    fire()
    await consumer.settle()

    feed.publish(note('n1'))
    await new Promise((resolve) => setImmediate(resolve))
    fire() // the run starts and holds n1
    await new Promise((resolve) => setImmediate(resolve))
    feed.publish(note('n2'))
    await new Promise((resolve) => setImmediate(resolve))
    fire() // the second wake finds the run busy
    gate.release()
    await drain()
    // Not parked behind a long idle look: the follow-up read is armed at once.
    expect([...armed.values()].map((timer) => timer.ms)).toEqual([0])
    fire()
    await drain()
    expect(seen).toEqual(['n1', 'n2'])
    expect(armed.size).toBe(0)
    await feed.close()
  })
})
