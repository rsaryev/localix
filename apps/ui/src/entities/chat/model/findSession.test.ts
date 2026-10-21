import { beforeEach, describe, it, expect } from 'bun:test'
import { findSessionInState } from './findSession'
import { clearLiveSessionBodies } from './sessionListHelpers'

beforeEach(clearLiveSessionBodies)

type S = { id: string; tag: string }
const sess = (id: string, tag: string): S => ({ id, tag })

describe('findSessionInState', () => {
  it('returns the match from the working `sessions` list', () => {
    const state = { sessions: [sess('a', 'working')], allSessions: [sess('b', 'roster')] }
    expect(findSessionInState(state, 'a')).toEqual(sess('a', 'working'))
  })

  it('falls back to `allSessions` when the id is not in the working list', () => {
    const state = { sessions: [sess('a', 'working')], allSessions: [sess('b', 'roster')] }
    expect(findSessionInState(state, 'b')).toEqual(sess('b', 'roster'))
  })

  it('prefers the `sessions` copy when the id is in BOTH lists', () => {
    const state = { sessions: [sess('a', 'working')], allSessions: [sess('a', 'roster')] }
    expect(findSessionInState(state, 'a')?.tag).toBe('working')
  })

  it('returns undefined when the id is in neither list', () => {
    const state = { sessions: [sess('a', 'working')], allSessions: [sess('b', 'roster')] }
    expect(findSessionInState(state, 'zzz')).toBeUndefined()
  })

  it('returns undefined for a null/undefined/empty id without scanning', () => {
    const state = { sessions: [sess('a', 'working')], allSessions: [sess('b', 'roster')] }
    expect(findSessionInState(state, null)).toBeUndefined()
    expect(findSessionInState(state, undefined)).toBeUndefined()
    expect(findSessionInState(state, '')).toBeUndefined()
  })
})
