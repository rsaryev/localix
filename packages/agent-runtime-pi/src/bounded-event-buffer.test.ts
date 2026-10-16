import { describe, expect, test } from 'bun:test'

import { BoundedEventBuffer } from './bounded-event-buffer'

describe('bounded event buffer', () => {
  test('backpressures a producer until capacity is released', async () => {
    const buffer = new BoundedEventBuffer<number>(2)
    await buffer.push(1)
    await buffer.push(2)
    let pushed = false
    const third = buffer.push(3).then((accepted) => {
      pushed = accepted
    })

    await Promise.resolve()
    expect(pushed).toBe(false)
    expect(buffer.length).toBe(2)
    expect(buffer.shift()).toBe(1)
    await third
    expect(pushed).toBe(true)
    expect([buffer.shift(), buffer.shift()]).toEqual([2, 3])
  })

  test('keeps the latest bounded window without blocking an unattached consumer', () => {
    const buffer = new BoundedEventBuffer<number>(2)
    expect(buffer.pushLatest(1)).toBe(true)
    expect(buffer.pushLatest(2)).toBe(true)
    expect(buffer.pushLatest(3)).toBe(true)

    expect(buffer.length).toBe(2)
    expect([buffer.shift(), buffer.shift()]).toEqual([2, 3])
  })

  test('closing with discard releases blocked producers without accepting more events', async () => {
    const buffer = new BoundedEventBuffer<number>(1)
    await buffer.push(1)
    const blocked = buffer.push(2)

    buffer.close(true)

    expect(await blocked).toBe(false)
    expect(buffer.length).toBe(0)
    expect(buffer.closed).toBe(true)
    expect(await buffer.push(3)).toBe(false)
  })

  test('releases each blocked producer as separate capacity becomes available', async () => {
    const buffer = new BoundedEventBuffer<number>(1)
    await buffer.push(1)
    const second = buffer.push(2)
    const third = buffer.push(3)

    expect(buffer.shift()).toBe(1)
    expect(await second).toBe(true)
    expect(buffer.shift()).toBe(2)
    expect(await third).toBe(true)
    expect(buffer.shift()).toBe(3)
  })

  test('coalesces a queued snapshot at the tail without losing lifecycle events', () => {
    const buffer = new BoundedEventBuffer<{
      type: string
      id: string
      value?: number
    }>(4)
    buffer.pushLatest({ type: 'update', id: 'a', value: 1 })
    buffer.pushLatest({ type: 'start', id: 'b' })
    buffer.pushLatest({ type: 'update', id: 'b', value: 1 })

    expect(
      buffer.coalesce(
        { type: 'update', id: 'a', value: 2 },
        (queued) => queued.type === 'update' && queued.id === 'a',
      ),
    ).toBe(true)
    expect(buffer.length).toBe(3)
    expect([buffer.shift(), buffer.shift(), buffer.shift()]).toEqual([
      { type: 'start', id: 'b' },
      { type: 'update', id: 'b', value: 1 },
      { type: 'update', id: 'a', value: 2 },
    ])
  })

  test('falls back to normal enqueue semantics when no snapshot matches', () => {
    const buffer = new BoundedEventBuffer<number>(2)
    buffer.pushLatest(1)

    expect(buffer.coalesce(2, (queued) => queued === 2)).toBe(false)
    expect(buffer.length).toBe(1)
    expect(buffer.shift()).toBe(1)

    buffer.close()
    expect(buffer.coalesce(3, () => true)).toBe(false)
  })

  test('bounds snapshots that arrive while the queue is already full', async () => {
    const buffer = new BoundedEventBuffer<{
      type: string
      id: string
      value?: number
    }>(1)
    await buffer.push({ type: 'start', id: 'a' })
    let firstSettled = false
    const first = buffer
      .pushCoalescing(
        { type: 'update', id: 'a', value: 1 },
        (queued) => queued.type === 'update' && queued.id === 'a',
      )
      .then((accepted) => {
        firstSettled = true
        return accepted
      })

    await Promise.resolve()
    expect(firstSettled).toBe(false)
    expect(
      await buffer.pushCoalescing(
        { type: 'update', id: 'a', value: 2 },
        (queued) => queued.type === 'update' && queued.id === 'a',
      ),
    ).toBe(true)

    expect(buffer.shift()).toEqual({ type: 'start', id: 'a' })
    expect(await first).toBe(true)
    expect(buffer.shift()).toEqual({ type: 'update', id: 'a', value: 2 })
  })

  test('closing releases a pending coalesced producer', async () => {
    const buffer = new BoundedEventBuffer<number>(1)
    await buffer.push(1)
    const pending = buffer.pushCoalescing(2, (queued) => queued === 2)

    buffer.close(true)

    expect(await pending).toBe(false)
  })
})
