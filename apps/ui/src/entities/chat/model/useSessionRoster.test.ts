import { describe, expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import { sameSessionRoster, sameSessionSummary } from './useSessionRoster'

const session = (patch: Partial<UiSession> = {}) =>
  ({ id: 's1', title: 'Chat', isRunning: true, messages: [], ...patch }) as unknown as UiSession

describe('sameSessionSummary', () => {
  // A streamed frame replaces the session with a longer `messages`: a list entry has not changed.
  test('a change confined to the body is the same list entry', () => {
    const before = session({ messages: [] })
    const after = {
      ...before,
      messages: [{ id: 'm1' }],
      streamingMessageId: 'm1',
      activePhase: null,
    }
    expect(sameSessionSummary(before, after as unknown as UiSession)).toBe(true)
  })

  test('any summary change is a new list entry', () => {
    const before = session()
    expect(sameSessionSummary(before, { ...before, title: 'Renamed' })).toBe(false)
    expect(sameSessionSummary(before, { ...before, isRunning: false })).toBe(false)
    expect(sameSessionSummary(before, { ...before, isUnread: true })).toBe(false)
    expect(sameSessionSummary(before, null)).toBe(false)
  })
})

describe('sameSessionRoster', () => {
  test('equal when every entry differs only in its body; not when one is added or renamed', () => {
    const a = [session({ id: 'a' }), session({ id: 'b' })]
    const streamed = [a[0]!, { ...a[1]!, messages: [{ id: 'm' }] } as unknown as UiSession]
    expect(sameSessionRoster(a, streamed)).toBe(true)
    expect(sameSessionRoster(a, [...a, session({ id: 'c' })])).toBe(false)
    expect(sameSessionRoster(a, [a[0]!, { ...a[1]!, title: 'New' }])).toBe(false)
  })
})
