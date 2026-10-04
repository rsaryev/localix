import { describe, expect, test } from 'bun:test'

import { createReloadTracker } from './reload-detect'

/** In-memory Storage stub that survives across "reloads" (new tracker, same store). */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('createReloadTracker', () => {
  test('first command of a FRESH load with no prior activity is NOT a reload', () => {
    const t = createReloadTracker(fakeStorage())
    expect(t.consume()).toBe(false) // first ever command
    expect(t.consume()).toBe(false) // subsequent commands never flag
  })

  test('after prior activity, the first command of a new load IS flagged once', () => {
    const store = fakeStorage()
    const a = createReloadTracker(store) // page load #1
    a.consume() // agent ran a command → activity recorded
    // Page reloads: a brand-new tracker over the SAME (surviving) sessionStorage.
    const b = createReloadTracker(store)
    expect(b.consume()).toBe(true) // first command after the reload → flagged
    expect(b.consume()).toBe(false) // only the first command of the load flags
  })

  test('a load where the agent never acted does not flag the next load', () => {
    const store = fakeStorage()
    createReloadTracker(store) // page load #1, no consume() → no activity recorded
    const b = createReloadTracker(store)
    expect(b.consume()).toBe(false)
  })

  test('a null storage (blocked) degrades to never-flagging, never throws', () => {
    const t = createReloadTracker(null)
    expect(() => t.consume()).not.toThrow()
    expect(t.consume()).toBe(false)
  })
})
