import { afterEach, describe, expect, test } from 'bun:test'

import { closeDurable, durableQueue } from './testing/test-durable'

/**
 * A head whose delivery fails every time used to be retried three times and then picked again
 * by every later drain: nothing queued behind it was ever delivered. It is parked as FAILED
 * instead, shown as such, and waits for the person to retry or remove it.
 */
afterEach(closeDurable)

async function poisonedHead() {
  let poisoned = true
  const h = await durableQueue({
    busy: true,
    beforeInsert: (rows) => {
      if (poisoned && rows.some((row) => row.payload.content === 'poison'))
        throw new Error('binding cannot be read')
    },
  })
  await h.say('poison')
  // A wake is never batched with the person's line: it is its own delivery behind the head.
  await h.queue.wake({ userId: 'u', session: h.session, content: 'next', source: 'bg-monitor' })
  h.idle()
  await h.until(() => h.delivered().includes('next'))
  return { h, cure: () => (poisoned = false) }
}

describe('a head that fails every delivery', () => {
  test('is parked as failed and the queue behind it moves on', async () => {
    const { h } = await poisonedHead()
    expect(h.delivered()).toEqual(['next'])
    expect(await h.queue.list('s')).toMatchObject([
      { preview: 'poison', delivery: 'failed', failure: 'binding cannot be read' },
    ])
    expect(await h.store.listSession('u', 's')).toMatchObject([
      { state: 'failed', failure: 'binding cannot be read' },
    ])
    // Parked is not "waiting to be heard": nothing would open a turn for it.
    expect(await h.queue.hasPending('s')).toBe(false)
  })

  test('send-now retries it without stopping anything, and it is delivered', async () => {
    const { h, cure } = await poisonedHead()
    cure()
    const [failed] = await h.queue.list('s')
    let interrupted = false
    expect(
      await h.queue.interruptAndPromote('u', 's', failed!.id, async () => {
        interrupted = true
      }),
    ).toEqual({ promoted: true })
    await h.until(() => h.delivered().includes('poison'))
    expect(interrupted).toBe(false)
    expect(h.delivered()).toEqual(['next', 'poison'])
    expect(await h.store.listSession('u', 's')).toEqual([])
  })

  test('can be removed, returning its text', async () => {
    const { h } = await poisonedHead()
    const [failed] = await h.queue.list('s')
    expect(await h.queue.remove('u', 's', failed!.id)).toEqual({
      removed: true,
      content: 'poison',
    })
    expect(await h.store.listSession('u', 's')).toEqual([])
  })

  test('stays failed across a restart', async () => {
    const { h } = await poisonedHead()
    const restarted = await durableQueue({ store: h.store, busy: true })
    expect(await restarted.queue.list('s')).toMatchObject([{ delivery: 'failed' }])
  })
})
