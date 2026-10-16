import { describe, expect, test } from 'bun:test'
import { capValues, collectCapped, singleFlightConnect } from './mongo'

function fakeCursor(total: number) {
  let read = 0
  let closed = false
  return {
    get read() {
      return read
    },
    get closed() {
      return closed
    },
    async *[Symbol.asyncIterator]() {
      while (read < total) {
        read += 1
        yield { n: read }
      }
    },
    async close() {
      closed = true
    },
  }
}

describe('mongo row cap', () => {
  test('an aggregate past the cap stops reading one document past it and closes', async () => {
    const cursor = fakeCursor(1_000_000)
    const result = await collectCapped(cursor, 3)
    expect(result.documents).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    expect(result.truncated).toBe(true)
    expect(cursor.read).toBe(4)
    expect(cursor.closed).toBe(true)
  })

  test('an aggregate at the cap is whole', async () => {
    const cursor = fakeCursor(3)
    const result = await collectCapped(cursor, 3)
    expect(result.documents).toHaveLength(3)
    expect(result.truncated).toBe(false)
    expect(cursor.closed).toBe(true)
  })

  test('distinct values past the cap are trimmed and flagged', () => {
    expect(capValues([1, 2, 3], 2)).toEqual({ documents: [1, 2], truncated: true })
    expect(capValues([1, 2], 2)).toEqual({ documents: [1, 2], truncated: false })
  })
})

describe('mongo connect', () => {
  test('concurrent first calls share one connect, and a failure is retried', async () => {
    let calls = 0
    let fail = true
    const ensure = singleFlightConnect(async () => {
      calls += 1
      if (fail) throw new Error('unreachable')
    })
    await Promise.all([ensure().catch(() => {}), ensure().catch(() => {})])
    expect(calls).toBe(1)
    fail = false
    await Promise.all([ensure(), ensure()])
    await ensure()
    expect(calls).toBe(2)
  })
})
