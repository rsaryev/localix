import { describe, expect, test } from 'bun:test'
import { createExclusiveQueue } from './exclusive-queue'

describe('single-connection exclusive queue', () => {
  test('an aborted waiter rejects immediately and still drains its FIFO slot', async () => {
    const queue = createExclusiveQueue()
    const releaseHead = await queue.acquire()
    const controller = new AbortController()
    const reason = new Error('stop waiting')
    let abortedOperationRan = false
    const aborted = queue.run(() => {
      abortedOperationRan = true
    }, controller.signal)

    controller.abort(reason)
    expect(aborted).rejects.toBe(reason)
    expect(abortedOperationRan).toBe(false)

    const follower = queue.run(() => 42)
    releaseHead()
    expect(await follower).toBe(42)
    expect(abortedOperationRan).toBe(false)
  })

  test('does not dispatch when abort lands during the acquired-lease handoff', async () => {
    const queue = createExclusiveQueue()
    const releaseHead = await queue.acquire()
    const controller = new AbortController()
    const reason = new Error('abort at handoff')
    let operationRan = false
    const pending = queue.run(() => {
      operationRan = true
    }, controller.signal)

    releaseHead()
    // First microtask lets acquire() resolve the lease. The nested one lands after
    // acquireOrAbort's lease callback but before run() resumes from its await.
    queueMicrotask(() => queueMicrotask(() => controller.abort(reason)))

    expect(pending).rejects.toBe(reason)
    expect(operationRan).toBe(false)
    expect(await queue.run(() => 42)).toBe(42)
  })
})
