import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { createDebouncer, createThrottle } from './debounce'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const advance = (ms: number) => void jest.advanceTimersByTime(ms)

describe('createDebouncer', () => {
  test('runs the scheduled fn once after the quiet period', async () => {
    const d = createDebouncer(15)
    let calls = 0
    d.schedule(() => {
      calls++
    })
    expect(calls).toBe(0) // trailing edge — not yet
    advance(40)
    expect(calls).toBe(1)
  })

  test('coalesces a burst — only the LAST scheduled fn runs once', async () => {
    const d = createDebouncer(15)
    const ran: string[] = []
    d.schedule(() => ran.push('a'))
    d.schedule(() => ran.push('b'))
    d.schedule(() => ran.push('c'))
    advance(40)
    expect(ran).toEqual(['c'])
  })

  test('cancel() prevents a pending run', async () => {
    const d = createDebouncer(15)
    let calls = 0
    d.schedule(() => {
      calls++
    })
    d.cancel()
    advance(40)
    expect(calls).toBe(0)
  })

  test('a later schedule after a completed run fires again', async () => {
    const d = createDebouncer(15)
    let calls = 0
    d.schedule(() => {
      calls++
    })
    advance(40)
    d.schedule(() => {
      calls++
    })
    advance(40)
    expect(calls).toBe(2)
  })

  test('cancel() on an idle debouncer is a no-op', () => {
    const d = createDebouncer(15)
    expect(() => d.cancel()).not.toThrow()
  })
})

describe('createThrottle', () => {
  test('the first call after quiet runs at once — nothing waits for the rest of the burst', () => {
    const t = createThrottle(50)
    const seen: string[] = []
    t.schedule(() => seen.push('syntax'))
    // Synchronous: the syntax-pass squiggle is published before the semantic pass arrives.
    expect(seen).toEqual(['syntax'])
    t.cancel()
  })

  test('calls inside the window collapse into ONE trailing run with the latest fn', async () => {
    const t = createThrottle(30)
    const seen: string[] = []
    t.schedule(() => seen.push('a'))
    t.schedule(() => seen.push('b'))
    t.schedule(() => seen.push('c'))
    expect(seen).toEqual(['a'])
    advance(60)
    expect(seen).toEqual(['a', 'c'])
  })

  test('cancel() drops the trailing run', async () => {
    const t = createThrottle(20)
    let calls = 0
    t.schedule(() => calls++)
    t.schedule(() => calls++)
    t.cancel()
    advance(40)
    expect(calls).toBe(1)
  })
})
