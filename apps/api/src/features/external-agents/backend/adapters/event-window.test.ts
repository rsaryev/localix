import { describe, expect, test } from 'bun:test'

import { eventWindow } from './event-window'
import type { PendingEvent } from './event-window'

/**
 * The rule four adapters used to spell four ways.
 *
 * Its load-bearing claim is that `ordinal` is a POSITION in the session, not an index into the
 * window: ids are derived from it and range lines are reported from it, so a tail window that
 * numbered its first kept event `0` would present the end of a session as its beginning.
 */
const turn = (text: string): PendingEvent => ({
  provider: 'claude-code',
  nativeSessionId: 'abc',
  role: 'user',
  text,
})

function fill(count: number, cap: number, tail: boolean) {
  const window = eventWindow(cap, tail)
  for (let index = 0; index < count; index += 1) window.emit(turn(`turn ${index}`))
  return window.result()
}

describe('the bounded event window', () => {
  test('a head window keeps the opening and still counts the rest', () => {
    const { events, total } = fill(50, 6, false)
    expect(total).toBe(50)
    expect(events.map((event) => event.ordinal)).toEqual([0, 1, 2, 3, 4, 5])
    expect(events.at(-1)?.text).toBe('turn 5')
  })

  test('a tail window keeps the end, numbered by where it actually is', () => {
    const { events, total } = fill(50, 6, true)
    expect(total).toBe(50)
    expect(events.map((event) => event.ordinal)).toEqual([44, 45, 46, 47, 48, 49])
    // The invariant every range line rests on: the last event kept is the last event there was.
    expect(events.at(-1)?.ordinal).toBe(total - 1)
    expect(events.at(-1)?.text).toBe('turn 49')
  })

  test('under the cap both ends agree, which is why the change was invisible at the head', () => {
    const head = fill(4, 10, false)
    const tail = fill(4, 10, true)
    expect(head.events.map((event) => event.ordinal)).toEqual([0, 1, 2, 3])
    expect(tail.events).toEqual(head.events)
  })

  test('an empty source reports nothing rather than a shape', () => {
    const { events, total } = fill(0, 10, true)
    expect(total).toBe(0)
    expect(events).toEqual([])
  })

  test('a cap below one still keeps an event rather than returning an empty transcript', () => {
    // `maxEvents` arrives from a caller and eventually from a schema; a zero must not turn a real
    // session into "no readable turns", which is a different and unrecoverable-looking answer.
    const { events, total } = fill(3, 0, true)
    expect(total).toBe(3)
    expect(events).toHaveLength(1)
    expect(events[0]?.ordinal).toBe(2)
  })
})

describe('an offset reaches what neither end does', () => {
  /**
   * Head and tail together still leave a hole. Measured on a real local history: 10 of 279 counted sessions
   * exceed the 2,000-event cap, and 14,189 events — 13.8% of all history here — sit beyond both a head
   * and a tail read of their own session. Verified against the largest of them: `from: 4000` returns
   * ordinals 4000-4004 of an 8,596-event session, which no head or tail read can produce.
   */
  test('the window starts at the ordinal asked for', () => {
    const window = eventWindow(3, false, 10)
    for (let i = 0; i < 20; i += 1) window.emit(turn(`e${i}`))

    const { events, total } = window.result()

    expect(events.map((event) => event.ordinal)).toEqual([10, 11, 12])
    // `total` is the whole source, not the part asked for: an offset is a window, not a filter that
    // hides how long the session is.
    expect(total).toBe(20)
  })

  test('an offset past the end yields nothing, and still reports the size', () => {
    const window = eventWindow(5, false, 99)
    for (let i = 0; i < 20; i += 1) window.emit(turn(`e${i}`))

    const { events, total } = window.result()

    expect(events).toEqual([])
    expect(total).toBe(20)
  })

  test('no offset behaves exactly as before', () => {
    const window = eventWindow(3)
    for (let i = 0; i < 20; i += 1) window.emit(turn(`e${i}`))

    expect(window.result().events.map((event) => event.ordinal)).toEqual([0, 1, 2])
  })

  test('an offset combined with tail keeps the LAST of what follows it', () => {
    // Not reachable through the tool, which rejects the pair, but the primitive must still be sane.
    const window = eventWindow(3, true, 10)
    for (let i = 0; i < 20; i += 1) window.emit(turn(`e${i}`))

    expect(window.result().events.map((event) => event.ordinal)).toEqual([17, 18, 19])
  })
})
