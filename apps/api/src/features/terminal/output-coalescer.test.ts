import { describe, expect, test } from 'bun:test'
import { createOutputCoalescer } from './output-coalescer'

/**
 * Manual scheduler: the coalescer's whole policy is "what happens between now and the
 * end of the window", so the window has to be steppable rather than waited on. Mirrors
 * the seam `backpressure.test.ts` uses on the other half of this transport.
 */
function manualClock() {
  let next = 1
  const pending = new Map<number, () => void>()
  let scheduled = 0
  return {
    schedule: (fn: () => void) => {
      scheduled++
      const h = next++
      pending.set(h, fn)
      return h
    },
    cancel: (h: unknown) => {
      pending.delete(h as number)
    },
    /** Fire every timer armed so far (one window boundary). */
    tick() {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, fn] of due) fn()
    },
    get armed() {
      return pending.size
    },
    /** How many timers were armed in total — an idle terminal must stop arming. */
    get scheduledCount() {
      return scheduled
    },
  }
}

function harness(opts: { maxBytes?: number } = {}) {
  const clock = manualClock()
  const frames: string[] = []
  const c = createOutputCoalescer((data) => frames.push(data), {
    windowMs: 8,
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...opts,
  })
  return { c, clock, frames }
}

describe('terminal output coalescer', () => {
  test('the first chunk after idle goes out immediately — keystroke echo is not delayed', () => {
    const { c, frames } = harness()
    c.push('$')
    // Synchronously, before any window boundary: a trailing-edge batcher would have
    // held this until the timer fired, adding the whole window to every keypress echo.
    expect(frames).toEqual(['$'])
  })

  test('chunks arriving inside the window merge into ONE frame, in order', () => {
    const { c, clock, frames } = harness()
    c.push('a') // leading edge
    for (const s of ['b', 'c', 'd', 'e']) c.push(s)
    expect(frames).toEqual(['a']) // still merging
    clock.tick()
    expect(frames).toEqual(['a', 'bcde'])
  })

  test('no byte is dropped or reordered — the concatenation is the original stream', () => {
    const { c, clock, frames } = harness()
    const chunks = Array.from({ length: 500 }, (_, i) => `chunk-${i};`)
    for (const ch of chunks) {
      c.push(ch)
      if (i32(ch) % 97 === 0) clock.tick() // window boundaries at irregular intervals
    }
    clock.tick()
    c.flush()
    expect(frames.join('')).toBe(chunks.join(''))
  })

  test('a flood collapses: 1,000 one-kilobyte chunks in one window cost 2 frames, not 1,000', () => {
    const { c, clock, frames } = harness({ maxBytes: 4 * 1024 * 1024 })
    const chunk = 'x'.repeat(1024) // the size Bun's PTY read buffer actually caps at
    for (let i = 0; i < 1000; i++) c.push(chunk)
    clock.tick()
    expect(frames).toHaveLength(2) // the leading chunk, then everything merged
    expect(frames.join('').length).toBe(1000 * 1024)
  })

  test('the byte cap flushes early so one window cannot buffer without bound', () => {
    const { c, frames } = harness({ maxBytes: 100 })
    c.push('lead')
    for (let i = 0; i < 6; i++) c.push('y'.repeat(20)) // 120 bytes > cap
    // Flushed on crossing the cap, with no window boundary in between: the fifth chunk
    // takes the merge to exactly 100 bytes and goes out with the four before it. The
    // sixth opens the next window, so the buffer never holds more than the cap.
    expect(frames).toHaveLength(2)
    expect(frames[1]).toBe('y'.repeat(100))
    expect(c.pendingByteCount).toBe(20)
  })

  test('an idle terminal stops arming timers', () => {
    const { c, clock } = harness()
    c.push('one')
    clock.tick() // window ends with nothing merged → must not re-arm
    expect(clock.armed).toBe(0)
    const afterIdle = clock.scheduledCount
    clock.tick()
    expect(clock.scheduledCount).toBe(afterIdle)
    // ...and the next chunk takes the leading edge again.
    c.push('two')
    expect(clock.armed).toBe(1)
  })

  test('flush() emits merged output so an exit frame cannot overtake it', () => {
    const { c, frames } = harness()
    c.push('building...') // leading edge
    c.push('done\n') // merged, unsent
    c.flush()
    expect(frames).toEqual(['building...', 'done\n'])
  })

  test('dispose drops the pending merge and stops scheduling (the socket is gone)', () => {
    const { c, clock, frames } = harness()
    c.push('lead')
    c.push('never sent')
    c.dispose()
    expect(clock.armed).toBe(0)
    c.push('after dispose')
    c.flush()
    clock.tick()
    expect(frames).toEqual(['lead'])
    c.dispose() // idempotent
  })
})

/** Ordinal of a `chunk-N;` fixture, for irregular window boundaries. */
function i32(chunk: string): number {
  return Number.parseInt(chunk.slice('chunk-'.length), 10)
}
