/**
 * The background settle window wakes on output, not on an 80ms interval.
 *
 * Timings are scaled down (tens of ms) so the rule — min, quiet-after-output, cap, exit — is
 * exercised for real; the wakeup count is what pins the fix: the old loop scheduled a tick
 * every 80ms whether or not anything was printed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { awaitBackgroundSettle, type SettleSource } from './bash-background-settle'

const WINDOW = { minMs: 60, maxMs: 400, quietMs: 20 }

function source(opts: { exited?: Promise<unknown> } = {}) {
  const listeners = new Set<() => void>()
  let last = 0
  let printed = false
  const src: SettleSource = {
    exited: opts.exited ?? new Promise(() => {}),
    onChunk: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hasOutput: () => printed,
    lastChunkAt: () => last,
  }
  const chunk = () => {
    printed = true
    last = Date.now()
    for (const listener of listeners) listener()
  }
  return { src, chunk, listeners }
}

const realSetInterval = globalThis.setInterval
afterEach(() => {
  globalThis.setInterval = realSetInterval
})

describe('awaitBackgroundSettle', () => {
  test('a silent job arms only the cap — no periodic wakeups', async () => {
    let intervals = 0
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      intervals++
      return realSetInterval(...args)
    }) as typeof setInterval
    const { src } = source()
    const start = Date.now()
    await awaitBackgroundSettle(src, WINDOW, start)
    expect(Date.now() - start).toBeGreaterThanOrEqual(WINDOW.maxMs - 5)
    expect(intervals).toBe(0)
  })

  test('early output then quiet returns after the minimum, well before the cap', async () => {
    const { src, chunk } = source()
    const start = Date.now()
    chunk()
    await awaitBackgroundSettle(src, WINDOW, start)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(WINDOW.minMs - 5)
    expect(elapsed).toBeLessThan(WINDOW.maxMs)
  })

  test('each chunk restarts the quiet window', async () => {
    const { src, chunk } = source()
    const start = Date.now()
    const talker = realSetInterval(chunk, 10)
    setTimeout(() => clearInterval(talker), 150)
    await awaitBackgroundSettle(src, WINDOW, start)
    clearInterval(talker)
    // Still talking at the minimum, so it settles only once the talk stops (~150ms + quiet).
    expect(Date.now() - start).toBeGreaterThanOrEqual(150)
  })

  test('an exit returns at once and leaves no listener behind', async () => {
    const { src, listeners } = source({ exited: Promise.resolve(0) })
    const start = Date.now()
    await awaitBackgroundSettle(src, WINDOW, start)
    expect(Date.now() - start).toBeLessThan(WINDOW.minMs)
    expect(listeners.size).toBe(0)
  })
})
