/**
 * Regression (preview command hangs): `settleTransitions` awaited
 * `requestAnimationFrame` with no timeout race. In a backgrounded/hidden Preview tab
 * rAF is PAUSED, and a page's own scripts can patch window.rAF (and setTimeout) to
 * QUEUE callbacks — so `await frame()` never resolved, `runCommand` never resolved, and
 * the UI's 10s "the preview did not respond in time" fired for every command. The settle
 * must resolve within its cap regardless. The test's own timeout converts a hang into a
 * clean assertion failure (rather than stalling the suite).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { settleTransitions } from './index'

// Capture the REAL timer for the test's own race timeout (a test may monkeypatch the global).
const realSetTimeout = setTimeout
const race = <T>(p: Promise<T>, hangValue: T, ms = 2000): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => realSetTimeout(() => r(hangValue), ms))])

describe('settleTransitions never stalls a command', () => {
  let origRaf: typeof globalThis.requestAnimationFrame
  let origSetTimeout: typeof globalThis.setTimeout

  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf
    globalThis.setTimeout = origSetTimeout
  })

  test('resolves within the cap when rAF is PAUSED (hidden/backgrounded tab)', async () => {
    origRaf = globalThis.requestAnimationFrame
    origSetTimeout = globalThis.setTimeout
    // A paused tab: rAF is called but its callback NEVER fires.
    globalThis.requestAnimationFrame = (() =>
      0) as unknown as typeof globalThis.requestAnimationFrame

    const outcome = await race(
      settleTransitions(400).then(() => 'settled' as const),
      'hung' as const,
    )
    expect(outcome).toBe('settled')
  })

  test('resolves even when BOTH rAF and setTimeout are QUEUED by the page', async () => {
    origRaf = globalThis.requestAnimationFrame
    origSetTimeout = globalThis.setTimeout
    // The page patches the globals to queue callbacks (never run them). settle must still
    // resolve because it captured the native timers at module load, before any patch.
    globalThis.requestAnimationFrame = (() =>
      0) as unknown as typeof globalThis.requestAnimationFrame
    globalThis.setTimeout = ((cb: () => void) => {
      void cb
      return 0
    }) as unknown as typeof globalThis.setTimeout

    const outcome = await race(
      settleTransitions(400).then(() => 'settled' as const),
      'hung' as const,
    )
    expect(outcome).toBe('settled')
  })
})
