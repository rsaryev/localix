import { afterEach, describe, expect, test } from 'bun:test'

import { closeDurable, durableQueue, durableStore, type DurableStore } from './testing/test-durable'

/**
 * A RELEASED BATCH: the person's two lines were claimed together, their transcript row was
 * written, and the delivery failed before acknowledgement — so both rows are pending again with
 * the batch's name. Whatever the person does to one of them now, neither line may be lost and
 * the turn may not be written twice.
 */
afterEach(closeDurable)

const LINES = ['use the staging database', 'and keep the old schema']
const TURN = LINES.join('\n\n')

async function releasedBatch() {
  const durable = await durableStore()
  let failTicket = true
  let h!: Awaited<ReturnType<typeof durableQueue>>
  const store: DurableStore = {
    ...durable,
    async enqueue(item) {
      if (failTicket && item.id.startsWith('agent-turn-')) {
        failTicket = false
        // Another run began meanwhile, so the retry waits for it to end.
        h.activeRuns.set('s', new AbortController())
        throw new Error('ticket insert failed')
      }
      return durable.enqueue(item)
    },
  }
  h = await durableQueue({ store, busy: true })
  for (const line of LINES) await h.say(line)
  h.idle()
  await h.until(async () => {
    const rows = await durable.listSession('u', 's')
    return rows.length === 2 && rows.every((row) => row.state === 'pending' && row.batchId)
  })
  expect(h.delivered()).toEqual([TURN])
  const [first, second] = await h.queue.list('s')
  return { h, durable, first: first!, second: second! }
}

/** The batch is delivered once, whole, and leaves the queue. */
async function deliveredOnce({ h, durable }: Awaited<ReturnType<typeof releasedBatch>>) {
  h.idle()
  await h.until(async () => (await durable.listSession('u', 's')).length === 0)
  expect(h.delivered()).toEqual([TURN])
  expect(await h.queue.list('s')).toEqual([])
}

describe('a released batch', () => {
  test('is listed with its batch name', async () => {
    const { first, second } = await releasedBatch()
    expect(first.batchId).toBeDefined()
    expect(second.batchId).toBe(first.batchId!)
  })

  test('send-now on one of its lines is refused and the batch is delivered whole', async () => {
    const batch = await releasedBatch()
    const result = await batch.h.queue.interruptAndPromote('u', 's', batch.second.id, async () => {
      batch.h.activeRuns.delete('s')
    })
    expect(result).toEqual({ promoted: false, reason: 'batched' })
    await deliveredOnce(batch)
  })

  test('a reprioritised line is refused, so the batch keeps its name and its transcript row', async () => {
    const batch = await releasedBatch()
    expect(await batch.h.queue.setPriority('u', 's', batch.second.id, -5)).toBe(false)
    await deliveredOnce(batch)
  })

  test('removing one line says it is batched; removing the batch returns both lines', async () => {
    const { h, durable, second } = await releasedBatch()
    expect(await h.queue.remove('u', 's', second.id)).toEqual({
      removed: false,
      reason: 'batched',
      batchSize: 2,
    })
    expect(await h.queue.remove('u', 's', second.id, { wholeBatch: true })).toEqual({
      removed: true,
      content: TURN,
    })
    expect(await durable.listSession('u', 's')).toEqual([])
    expect(await h.queue.list('s')).toEqual([])
  })

  test('clear removes the batch instead of reporting it as being sent', async () => {
    const { h, durable } = await releasedBatch()
    expect(await h.queue.clear('u', 's')).toEqual({ removed: 2, retained: [] })
    expect(await durable.listSession('u', 's')).toEqual([])
  })
})

describe('the durable claim of a batch', () => {
  test('keeps the name it was first claimed under when another of its rows leads', async () => {
    const store = await durableStore()
    for (const id of ['a', 'b'])
      await store.enqueue({
        id,
        userId: 'u',
        sessionId: 's',
        priority: 0,
        kind: 'user',
        payload: { content: id } as never,
        deliveryKey: id,
        queuedAt: '2026-10-21T00:00:00.000Z',
      })
    const at = '2026-10-21T00:00:00.000Z'
    const until = '2026-10-21T00:01:00.000Z'
    expect(await store.claim('u', 's', ['a', 'b'], 'one', at, until, 'a')).toBe(true)
    await store.release('u', 's', ['a', 'b'], 'one')
    expect(await store.claim('u', 's', ['b', 'a'], 'two', at, until, 'b')).toBe(true)
    expect((await store.listSession('u', 's')).map((row) => row.batchId)).toEqual(['a', 'a'])
  })
})
