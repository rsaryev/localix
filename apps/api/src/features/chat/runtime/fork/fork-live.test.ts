import { describe, expect, test } from 'bun:test'

import { createRecordedCalls } from './fork-live'

/**
 * The loop does not wait for the host's event handler: a tool can start executing while the
 * handler is still writing the message that made the call into the row. A fork reads that row, so
 * it waits until the handler has recorded the call.
 */
describe('waiting until a call is recorded', () => {
  test('a call already recorded is ready at once', async () => {
    const calls = createRecordedCalls()
    calls.note('c1')
    await calls.when('c1')
  })

  test('a call recorded later releases the one waiting for it, and only that one', async () => {
    const calls = createRecordedCalls()
    const order: string[] = []
    const first = calls.when('c1').then(() => order.push('c1'))
    const second = calls.when('c2').then(() => order.push('c2'))
    calls.note('c2')
    await second
    expect(order).toEqual(['c2'])
    calls.note('c1')
    await first
    expect(order).toEqual(['c2', 'c1'])
  })

  test('a stopped run does not leave the wait hanging', async () => {
    const calls = createRecordedCalls()
    const stop = new AbortController()
    const waiting = calls.when('c1', stop.signal)
    stop.abort()
    await expect(waiting).rejects.toThrow(/stopped/)
  })
})
