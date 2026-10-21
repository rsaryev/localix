import { describe, expect, test } from 'bun:test'
import { IDLE_NAV, stepOlder, stepNewer } from './promptHistoryNav'

// oldest → newest: 'a' oldest, 'c' newest.
const P = ['a', 'b', 'c']

describe('stepOlder (ArrowUp)', () => {
  test('first step stashes the draft and recalls the NEWEST entry', () => {
    const { nav, value } = stepOlder(P, IDLE_NAV, 'typing…')
    expect(value).toBe('c')
    expect(nav).toEqual({ index: 0, draft: 'typing…' })
  })

  test('walks toward older entries, preserving the stashed draft', () => {
    const s1 = stepOlder(P, IDLE_NAV, 'd')
    const s2 = stepOlder(P, s1.nav, 'ignored') // current is only stashed on the FIRST step
    expect(s2.value).toBe('b')
    expect(s2.nav).toEqual({ index: 1, draft: 'd' })
    const s3 = stepOlder(P, s2.nav, 'ignored')
    expect(s3.value).toBe('a') // oldest
    expect(s3.nav.index).toBe(2)
  })

  test('clamps at the oldest — stays put and keeps returning it', () => {
    const atOldest = { index: 2, draft: 'd' }
    const { nav, value } = stepOlder(P, atOldest, 'x')
    expect(value).toBe('a')
    expect(nav).toBe(atOldest) // unchanged reference (no step)
  })

  test('empty history is a no-op', () => {
    expect(stepOlder([], IDLE_NAV, 'x')).toEqual({ nav: IDLE_NAV, value: null })
  })
})

describe('stepNewer (ArrowDown)', () => {
  test('is a no-op while idle', () => {
    expect(stepNewer(P, IDLE_NAV)).toEqual({ nav: IDLE_NAV, value: null })
  })

  test('walks toward newer entries', () => {
    const { nav, value } = stepNewer(P, { index: 2, draft: 'd' })
    expect(value).toBe('b')
    expect(nav).toEqual({ index: 1, draft: 'd' })
  })

  test('past the newest, restores the stashed draft and goes idle', () => {
    const { nav, value } = stepNewer(P, { index: 0, draft: 'my draft' })
    expect(value).toBe('my draft')
    expect(nav.index).toBe(-1)
  })
})

describe('round trip', () => {
  test('up to the oldest then back down restores the original draft', () => {
    let nav = IDLE_NAV
    const seen: (string | null)[] = []
    for (let i = 0; i < 3; i++) {
      const s = stepOlder(P, nav, 'orig')
      nav = s.nav
      seen.push(s.value)
    }
    expect(seen).toEqual(['c', 'b', 'a']) // newest → oldest
    const back: (string | null)[] = []
    for (let i = 0; i < 3; i++) {
      const s = stepNewer(P, nav)
      nav = s.nav
      back.push(s.value)
    }
    expect(back).toEqual(['b', 'c', 'orig']) // older → newer → draft
    expect(nav.index).toBe(-1) // idle again
  })
})
