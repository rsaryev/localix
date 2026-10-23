import { afterEach, expect, test } from 'bun:test'

import { closeDurable, durableQueue, durableStore, type DurableStore } from './testing/test-durable'

/** The queue chip says what IS queued: a turn appears once its row is durable, never before. */
afterEach(closeDurable)

const queueEvents = (published: unknown[]) =>
  published.filter((event) => (event as { type: string }).type === 'session_queue.updated')

test('a failed durable insert publishes nothing — no chip that flickers away', async () => {
  const durable = await durableStore()
  const store: DurableStore = {
    ...durable,
    enqueue: async () => {
      throw new Error('SQLITE_FULL')
    },
  }
  const h = await durableQueue({ store, busy: true })
  await expect(h.say('lost to a full disk')).rejects.toThrow('SQLITE_FULL')
  expect(queueEvents(h.published)).toEqual([])
  expect(await h.queue.list('s')).toEqual([])
})

test('a durable insert publishes the queue with the new turn', async () => {
  const h = await durableQueue({ busy: true })
  await h.say('queued')
  expect(queueEvents(h.published)).toMatchObject([{ queue: [{ preview: 'queued' }] }])
})
