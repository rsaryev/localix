import { describe, expect, test } from 'bun:test'

import { createEventBatcher, type BatchTimerHandle } from './batch'
import type { MonitorEvent } from './contracts'

/**
 * A fake clock + timer, so the coalescing window and the rate window are driven rather than
 * waited out. Mirrors the injectable-timer shape the batcher declares.
 */
function harness(over: { maxPerWindow?: number; windowMs?: number } = {}) {
  let nowMs = 1_000
  const timers = new Map<BatchTimerHandle, { fn: () => void; at: number }>()
  const flushes: MonitorEvent[][] = []
  const limited: { observed: number; pending: MonitorEvent[] }[] = []
  const batcher = createEventBatcher({
    onFlush: (events) => flushes.push(events),
    onRateLimited: (observed, pending) => limited.push({ observed, pending }),
    now: () => nowMs,
    setTimer: (fn, ms) => {
      const handle: BatchTimerHandle = {}
      timers.set(handle, { fn, at: nowMs + ms })
      return handle
    },
    clearTimer: (handle) => {
      timers.delete(handle)
    },
    windowMs: over.windowMs ?? 200,
    rateWindowMs: 60_000,
    maxPerWindow: over.maxPerWindow ?? 5,
  })
  return {
    batcher,
    flushes,
    limited,
    advance(ms: number) {
      nowMs += ms
      for (const [handle, timer] of new Map(timers)) {
        if (timer.at <= nowMs) {
          timers.delete(handle)
          timer.fn()
        }
      }
    },
    pendingTimers: () => timers.size,
  }
}

describe('createEventBatcher', () => {
  test('coalesces events inside the window into ONE delivery', () => {
    // A stack trace or a `git status` block is several lines and one fact; delivering it per
    // line would open a turn per line.
    const h = harness()
    h.batcher.push('Traceback (most recent call last):')
    h.batcher.push('  File "app.py", line 3')
    h.batcher.push('ValueError: boom')
    expect(h.flushes).toHaveLength(0)
    h.advance(200)
    expect(h.flushes).toHaveLength(1)
    expect(h.flushes[0]?.map((event) => event.text)).toEqual([
      'Traceback (most recent call last):',
      '  File "app.py", line 3',
      'ValueError: boom',
    ])
  })

  test('a later event opens a NEW window instead of joining a delivered batch', () => {
    const h = harness()
    h.batcher.push('first')
    h.advance(200)
    h.batcher.push('second')
    h.advance(200)
    expect(h.flushes.map((batch) => batch.map((event) => event.text))).toEqual([
      ['first'],
      ['second'],
    ])
  })

  test('flushNow delivers immediately (a monitor that just ended)', () => {
    const h = harness()
    h.batcher.push('last line before exit')
    h.batcher.flushNow()
    expect(h.flushes).toHaveLength(1)
    // The pending timer must be gone, or the same batch would be delivered twice.
    expect(h.pendingTimers()).toBe(0)
    h.advance(200)
    expect(h.flushes).toHaveLength(1)
  })

  test('past the allowance it hands the pending events to onRateLimited and refuses more', () => {
    const h = harness({ maxPerWindow: 3 })
    expect(h.batcher.push('a')).toBe(true)
    expect(h.batcher.push('b')).toBe(true)
    expect(h.batcher.push('c')).toBe(true)
    // The 4th exceeds the window's allowance.
    expect(h.batcher.push('d')).toBe(false)
    expect(h.limited).toHaveLength(1)
    expect(h.limited[0]?.observed).toBe(4)
    // Carried, NOT flushed: the caller composes one terminal notification out of them, so a
    // monitor stopped for chattiness costs one turn rather than two.
    expect(h.flushes).toHaveLength(0)
    expect(h.limited[0]?.pending.map((event) => event.text)).toEqual(['a', 'b', 'c', 'd'])
    expect(h.batcher.push('e')).toBe(false)
  })

  test('the rate window slides — a slow trickle is never rate-limited', () => {
    const h = harness({ maxPerWindow: 3 })
    for (let i = 0; i < 10; i += 1) {
      expect(h.batcher.push(`line ${i}`)).toBe(true)
      h.advance(30_000)
    }
    expect(h.limited).toHaveLength(0)
  })

  test('dispose stops delivery and refuses further pushes', () => {
    const h = harness()
    h.batcher.push('pending when disposed')
    h.batcher.dispose()
    h.advance(1_000)
    expect(h.flushes).toHaveLength(0)
    expect(h.batcher.push('after')).toBe(false)
  })
})
