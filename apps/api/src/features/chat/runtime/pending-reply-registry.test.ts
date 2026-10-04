import { describe, expect, test } from 'bun:test'

import { createPendingReplyRegistry, type ReplyScheduler } from './pending-reply-registry'

function manualScheduler() {
  let nextId = 0
  const callbacks = new Map<number, () => void>()
  const delays = new Map<number, number>()
  const cancelled: number[] = []
  const scheduler: ReplyScheduler = {
    schedule(callback, delayMs) {
      const id = ++nextId
      callbacks.set(id, callback)
      delays.set(id, delayMs)
      return id
    },
    cancel(handle) {
      const id = handle as number
      callbacks.delete(id)
      cancelled.push(id)
    },
  }
  return {
    scheduler,
    fire(id: number) {
      const callback = callbacks.get(id)
      callbacks.delete(id)
      callback?.()
    },
    delay(id: number) {
      return delays.get(id)
    },
    get cancelled() {
      return cancelled
    },
  }
}

type Outcome = { kind: 'reply' | 'timeout' | 'failed' | 'closed'; value?: string }
type Meta = { sessionId: string; owner: string }

const timeout = (): Outcome => ({ kind: 'timeout' })
const failed = (error: unknown): Outcome => ({ kind: 'failed', value: String(error) })

describe('pending reply registry', () => {
  test('parks before publish, so a synchronous reply settles exactly once', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler)
    let accepted = false

    const result = registry.request({
      id: 'r1',
      meta: { sessionId: 's1', owner: 'alice' },
      timeoutMs: 12.9,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {
        accepted = registry.resolve('r1', (meta) => meta.owner === 'alice', {
          kind: 'reply',
          value: 'ok',
        })
      },
    })

    expect(accepted).toBe(true)
    expect(await result).toEqual({ kind: 'reply', value: 'ok' })
    expect(clock.delay(1)).toBe(12)
    expect(clock.cancelled).toEqual([1])
    expect(registry.resolve('r1', () => true, { kind: 'reply' })).toBe(false)
  })

  test('timeout is deterministic and a late reply cannot settle it again', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler)
    let published = 0
    const result = registry.request({
      id: 'r2',
      meta: { sessionId: 's1', owner: 'alice' },
      timeoutMs: 500,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => published++,
    })

    expect(published).toBe(1)
    clock.fire(1)
    expect(await result).toEqual({ kind: 'timeout' })
    expect(registry.resolve('r2', () => true, { kind: 'reply' })).toBe(false)
  })

  test('publish failure releases the pending entry and cancels its timer immediately', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler)
    const result = registry.request({
      id: 'r3',
      meta: { sessionId: 's1', owner: 'alice' },
      timeoutMs: 500,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {
        throw new Error('serialize failed')
      },
    })

    expect(await result).toMatchObject({ kind: 'failed', value: 'Error: serialize failed' })
    expect(clock.cancelled).toEqual([1])
    expect(registry.resolve('r3', () => true, { kind: 'reply' })).toBe(false)
  })

  test('closeWhere settles only matching requests and leaves the others replyable', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler)
    const open = (id: string, sessionId: string) =>
      registry.request({
        id,
        meta: { sessionId, owner: 'alice' },
        timeoutMs: 500,
        onTimeout: timeout,
        onPublishError: failed,
        publish: () => {},
      })
    const first = open('a', 's1')
    const second = open('b', 's2')

    registry.closeWhere((meta) => meta.sessionId === 's1', { kind: 'closed' })
    expect(await first).toEqual({ kind: 'closed' })
    expect(registry.resolve('b', () => true, { kind: 'reply', value: 'still-open' })).toBe(true)
    expect(await second).toEqual({ kind: 'reply', value: 'still-open' })
  })

  test('invalid timeouts fail closed without publishing or leaving a pending request', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler)
    let published = false
    const result = registry.request({
      id: 'invalid',
      meta: { sessionId: 's1', owner: 'alice' },
      timeoutMs: Number.NaN,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {
        published = true
      },
    })

    expect(await result).toMatchObject({ kind: 'failed', value: 'Error: Invalid timeoutMs: NaN' })
    expect(published).toBe(false)
    expect(registry.resolve('invalid', () => true, { kind: 'reply' })).toBe(false)
  })

  test('duplicate ids fail the newcomer without orphaning the original request', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler)
    let duplicatePublished = false
    const original = registry.request({
      id: 'same',
      meta: { sessionId: 's1', owner: 'alice' },
      timeoutMs: 500,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {},
    })
    const duplicate = registry.request({
      id: 'same',
      meta: { sessionId: 's2', owner: 'bob' },
      timeoutMs: 500,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {
        duplicatePublished = true
      },
    })

    expect(await duplicate).toMatchObject({
      kind: 'failed',
      value: 'Error: Pending reply id already exists: same',
    })
    expect(duplicatePublished).toBe(false)
    expect(registry.size()).toBe(1)
    expect(registry.resolve('same', () => true, { kind: 'reply', value: 'original' })).toBe(true)
    expect(await original).toEqual({ kind: 'reply', value: 'original' })
    expect(registry.size()).toBe(0)
  })

  test('capacity exhaustion fails closed without allocating a timer or publishing', async () => {
    const clock = manualScheduler()
    const registry = createPendingReplyRegistry<Outcome, Meta>(clock.scheduler, { maxPending: 1 })
    const first = registry.request({
      id: 'first',
      meta: { sessionId: 's1', owner: 'alice' },
      timeoutMs: 500,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {},
    })
    let published = false
    const overflow = registry.request({
      id: 'overflow',
      meta: { sessionId: 's2', owner: 'bob' },
      timeoutMs: 500,
      onTimeout: timeout,
      onPublishError: failed,
      publish: () => {
        published = true
      },
    })

    expect(await overflow).toMatchObject({
      kind: 'failed',
      value: 'Error: Pending reply capacity exhausted (1); request not published',
    })
    expect(published).toBe(false)
    expect(registry.size()).toBe(1)
    expect(registry.resolve('first', () => true, { kind: 'closed' })).toBe(true)
    await first
  })
})
