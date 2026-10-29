import { expect, test } from 'bun:test'
import { createReadAhead } from './readAhead'

/** A clock and timers the test turns by hand. */
function harness() {
  let now = 0
  let pending: { at: number; fire: () => void } | null = null
  const read: string[] = []
  const ahead = createReadAhead<string>({
    delayMs: 120,
    now: () => now,
    setTimer: (fire, ms) => {
      pending = { at: now + ms, fire }
      return () => {
        pending = null
      }
    },
    read: (id) => read.push(id),
  })
  const advance = (ms: number) => {
    now += ms
    if (pending && pending.at <= now) {
      const { fire } = pending
      pending = null
      fire()
    }
  }
  return { ahead, read, advance }
}

test('a pointer that rests on a card reads its page ahead', () => {
  const { ahead, read, advance } = harness()
  ahead.intent('puzzle')
  advance(120)
  expect(read).toEqual(['puzzle'])
})

// Scrolling slides cards under a still pointer: each fired an intent, and each opened page
// fetched its package and re-indexed the Store. Only a pointer that stops counts.
test('cards that pass under the pointer while the list scrolls are not read', () => {
  const { ahead, read, advance } = harness()
  ahead.scrolled()
  ahead.intent('a')
  advance(60)
  ahead.scrolled()
  ahead.intent('b')
  advance(200)
  expect(read).toEqual([])
})

test('a scroll that starts while a card waits cancels its read', () => {
  const { ahead, read, advance } = harness()
  ahead.intent('a')
  advance(60)
  ahead.scrolled()
  advance(200)
  expect(read).toEqual([])
})

test('leaving the card before the delay cancels its read', () => {
  const { ahead, read, advance } = harness()
  ahead.intent('a')
  advance(60)
  ahead.leave()
  advance(200)
  expect(read).toEqual([])
})
