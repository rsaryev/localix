import { afterEach, describe, expect, test } from 'bun:test'

import { closeDurable, durableQueue } from './testing/test-durable'

/**
 * Stop takes the person's queued words back: they leave the queue in one step, so nothing the
 * stopped run's teardown drains can deliver them, and they come back whole and in order.
 */
afterEach(closeDurable)

describe('taking the queued messages back for the composer', () => {
  test('returns the person words in order and no later drain delivers them', async () => {
    const h = await durableQueue({ busy: true })
    await h.say('first line')
    await h.say('second line')

    const taken = await h.queue.takeForReturn('u', 's')
    expect(taken.map((item) => item.content)).toEqual(['first line', 'second line'])

    h.idle()
    await h.until(() => h.runs.length > 0, 100)
    expect(h.runs).toEqual([])
    expect(h.delivered()).toEqual([])
    expect(await h.queue.list('s')).toEqual([])
  })

  test('keeps a machine wake queued: it is not the person words', async () => {
    const h = await durableQueue({ busy: true })
    await h.queue.wake({
      userId: 'u',
      session: h.session,
      content: 'job finished',
      internal: true,
      source: 'bg-job',
    })
    await h.say('mine')

    const taken = await h.queue.takeForReturn('u', 's')
    expect(taken.map((item) => item.content)).toEqual(['mine'])
    expect((await h.queue.list('s')).map((item) => item.kind)).toEqual(['wake'])
  })

  test('carries each message attachments and its optimistic row id', async () => {
    const h = await durableQueue({ busy: true })
    const bindings = [{ kind: 'file', ref: 'a.txt' }] as never
    await h.queue.wake({
      userId: 'u',
      session: h.session,
      content: 'see this',
      internal: false,
      source: 'user-busy',
      bindings,
      clientMessageId: 'c1',
    })
    const [item] = await h.queue.takeForReturn('u', 's')
    expect(item).toEqual({ content: 'see this', bindings, clientMessageId: 'c1' })
  })

  test('answers nothing for a session with an empty queue', async () => {
    const h = await durableQueue({ busy: true })
    expect(await h.queue.takeForReturn('u', 's')).toEqual([])
  })
})
