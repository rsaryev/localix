import { afterEach, describe, expect, test } from 'bun:test'
import { pluginCommandBus, type PluginCommandFrame } from './commands'

const frame = (over: Partial<PluginCommandFrame> = {}): PluginCommandFrame => ({
  sessionId: 's-1',
  plugin: 'sample-plugin',
  channel: 'chart',
  payload: { action: 'open' },
  commandId: `cmd-${Math.random()}`,
  seq: 1,
  ...over,
})

afterEach(() => pluginCommandBus._clearApplied())

describe('pluginCommandBus — the typed plugin.command dispatcher', () => {
  test('routes by (plugin, channel) and carries sessionId + active through', () => {
    const seen: Array<{ sessionId: string; active: boolean; payload: unknown }> = []
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', (e) =>
      seen.push({ sessionId: e.sessionId, active: e.active, payload: e.payload }),
    )
    try {
      pluginCommandBus.publish(frame({ payload: { x: 1 } }), true)
      pluginCommandBus.publish(frame({ payload: { x: 2 } }), false)
      expect(seen).toEqual([
        { sessionId: 's-1', active: true, payload: { x: 1 } },
        { sessionId: 's-1', active: false, payload: { x: 2 } },
      ])
    } finally {
      unsub()
    }
  })

  test('is NON-COALESCING: two back-to-back commands both land, in order', () => {
    const seqs: number[] = []
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', (e) => seqs.push(e.seq))
    try {
      pluginCommandBus.publish(frame({ seq: 1 }), true)
      pluginCommandBus.publish(frame({ seq: 2 }), true)
      expect(seqs).toEqual([1, 2])
    } finally {
      unsub()
    }
  })

  test('a replayed frame (same commandId) is applied at most once', () => {
    let calls = 0
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', () => calls++)
    try {
      const f = frame({ commandId: 'cmd-replay' })
      pluginCommandBus.publish(f, true)
      pluginCommandBus.publish(f, true) // SSE replay on reconnect
      expect(calls).toBe(1)
    } finally {
      unsub()
    }
  })

  test('a frame for an unregistered (plugin, channel) key is dropped, not queued', () => {
    let calls = 0
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', () => calls++)
    try {
      pluginCommandBus.publish(frame({ plugin: 'other' }), true)
      pluginCommandBus.publish(frame({ channel: 'orders' }), true)
      expect(calls).toBe(0)
    } finally {
      unsub()
    }
  })

  test('one throwing sink neither breaks the fan-out nor the stream router above', () => {
    const seen: number[] = []
    const unsubA = pluginCommandBus.register('sample-plugin', 'chart', () => {
      throw new Error('broken sink')
    })
    const unsubB = pluginCommandBus.register('sample-plugin', 'chart', (e) => seen.push(e.seq))
    try {
      expect(() => pluginCommandBus.publish(frame({ seq: 7 }), true)).not.toThrow()
      expect(seen).toEqual([7])
    } finally {
      unsubA()
      unsubB()
    }
  })

  test('the reply seam rides the event to the sink, bound by the caller', () => {
    const replies: unknown[] = []
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', (e) =>
      e.reply?.({ ok: true, result: { mounted: true } }),
    )
    try {
      pluginCommandBus.publish(frame(), true, (payload) => replies.push(payload))
      expect(replies).toEqual([{ ok: true, result: { mounted: true } }])
      // Without a reply seam the event simply carries none — sinks must tolerate that.
      pluginCommandBus.publish(frame(), true)
      expect(replies).toHaveLength(1)
    } finally {
      unsub()
    }
  })

  test('a replayed frame is deduped BEFORE the reply seam — no double answer', () => {
    let replyCount = 0
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', (e) => {
      e.reply?.({ ok: true })
    })
    try {
      const f = frame({ commandId: 'cmd-reply-replay' })
      pluginCommandBus.publish(f, true, () => replyCount++)
      pluginCommandBus.publish(f, true, () => replyCount++)
      expect(replyCount).toBe(1)
    } finally {
      unsub()
    }
  })

  test('unsubscribe stops delivery', () => {
    let calls = 0
    const unsub = pluginCommandBus.register('sample-plugin', 'chart', () => calls++)
    unsub()
    pluginCommandBus.publish(frame(), true)
    expect(calls).toBe(0)
  })
})
