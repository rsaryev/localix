import { afterEach, describe, expect, test } from 'bun:test'

import { closeDurable, durableQueue, durableStore, type DurableStore } from './test-durable'

/**
 * A durable lease is how long one owner may hold a delivery. Held longer than the delivery takes,
 * it must be renewed; held by another owner that dies, it must be looked at again when it runs out.
 */
afterEach(closeDurable)

const soon = (ms: number) => new Date(Date.now() + ms).toISOString()

describe('a lease another runtime holds', () => {
  test('is drained again once it expires, instead of stranding the turn', async () => {
    const durable = await durableStore()
    // Another process claims every row as it is admitted, then dies without acknowledging.
    const store: DurableStore = {
      ...durable,
      async enqueue(item) {
        const admitted = await durable.enqueue(item)
        await durable.claim(item.userId, item.sessionId, [item.id], 'dead', soon(0), soon(80))
        return admitted
      },
    }
    const h = await durableQueue({ store })
    await h.say('still here')
    expect(h.delivered()).toEqual([])
    // The turn, and then the reply's ticket (claimed the same way), each wait out the lease.
    await h.until(() => h.runs.length > 0)
    expect(h.delivered()).toEqual(['still here'])
    expect(h.runs).toHaveLength(1)
    expect(await durable.listSession('u', 's')).toEqual([])
  })
})

describe('a delivery that outlasts its lease', () => {
  test('renews the lease while it runs', async () => {
    let h!: Awaited<ReturnType<typeof durableQueue>>
    let leaseAfterWait: string | undefined
    let slow = true
    h = await durableQueue({
      context: { leaseMs: 60 },
      beforeRead: async () => {
        if (!slow) return
        slow = false
        await new Promise((resolve) => setTimeout(resolve, 200))
        leaseAfterWait = (await h.store.listSession('u', 's'))[0]?.leaseExpiresAt
      },
    })
    await h.say('a slow delivery')
    await h.until(() => h.delivered().length > 0)
    expect(leaseAfterWait).toBeDefined()
    // Claimed for 60ms, 200ms ago: only a renewal keeps it in the future.
    expect(Date.parse(leaseAfterWait!)).toBeGreaterThan(Date.now() - 40)
    expect(h.delivered()).toEqual(['a slow delivery'])
  })
})
