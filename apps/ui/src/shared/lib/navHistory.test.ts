import { describe, it, expect } from 'bun:test'
import {
  emptyNav,
  pushNav,
  backNav,
  forwardNav,
  MAX_NAV_ENTRIES,
  type NavLocation,
} from './navHistory'

const loc = (path: string, line?: number, sessionId = 'S-A'): NavLocation => ({
  sessionId,
  path,
  line,
})

describe('pushNav', () => {
  it('treats the same file in another chat as a new location — stepping back reopens it in ITS chat', () => {
    let s = pushNav(emptyNav(), loc('a', 1, 'S-A'))
    s = pushNav(s, loc('a', 1, 'S-B'))
    expect(s.entries).toEqual([loc('a', 1, 'S-A'), loc('a', 1, 'S-B')])
    expect(backNav(s).target).toEqual(loc('a', 1, 'S-A'))
  })

  it('appends to an empty stack and points at it', () => {
    const s = pushNav(emptyNav(), loc('a', 1))
    expect(s.entries).toEqual([loc('a', 1)])
    expect(s.index).toBe(0)
  })

  it('de-dupes an immediate repeat of the current location', () => {
    let s = pushNav(emptyNav(), loc('a', 1))
    s = pushNav(s, loc('a', 1))
    expect(s.entries.length).toBe(1)
  })

  it('treats a different line in the same file as a new location', () => {
    let s = pushNav(emptyNav(), loc('a', 1))
    s = pushNav(s, loc('a', 42))
    expect(s.entries).toEqual([loc('a', 1), loc('a', 42)])
    expect(s.index).toBe(1)
  })

  it('drops the forward tail when a new jump forks history', () => {
    let s = emptyNav()
    for (const p of ['a', 'b', 'c']) s = pushNav(s, loc(p))
    // Go back twice to 'a', then jump to a new file.
    s = backNav(backNav(s).state).state
    expect(s.index).toBe(0)
    s = pushNav(s, loc('d'))
    expect(s.entries.map((e) => e.path)).toEqual(['a', 'd'])
    expect(s.index).toBe(1)
  })

  it('caps retained history from the front', () => {
    let s = emptyNav()
    for (let i = 0; i < MAX_NAV_ENTRIES + 10; i++) s = pushNav(s, loc(`f${i}`))
    expect(s.entries.length).toBe(MAX_NAV_ENTRIES)
    expect(s.index).toBe(MAX_NAV_ENTRIES - 1)
    // Oldest entries were dropped; the most recent is kept.
    expect(s.entries[s.entries.length - 1].path).toBe(`f${MAX_NAV_ENTRIES + 9}`)
  })
})

describe('backNav / forwardNav', () => {
  const build = (): ReturnType<typeof emptyNav> => {
    let s = emptyNav()
    for (const p of ['a', 'b', 'c']) s = pushNav(s, loc(p))
    return s
  }

  it('steps back to earlier locations and stops at the start', () => {
    const s = build()
    const b1 = backNav(s)
    expect(b1.target).toEqual(loc('b'))
    const b2 = backNav(b1.state)
    expect(b2.target).toEqual(loc('a'))
    const b3 = backNav(b2.state)
    expect(b3.target).toBeNull()
    expect(b3.state.index).toBe(0)
  })

  it('steps forward again after going back and stops at the end', () => {
    let s = build()
    s = backNav(backNav(s).state).state // at 'a'
    const f1 = forwardNav(s)
    expect(f1.target).toEqual(loc('b'))
    const f2 = forwardNav(f1.state)
    expect(f2.target).toEqual(loc('c'))
    expect(forwardNav(f2.state).target).toBeNull()
  })

  it('returns null on an empty stack', () => {
    expect(backNav(emptyNav()).target).toBeNull()
    expect(forwardNav(emptyNav()).target).toBeNull()
  })
})
