import { expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { selectAtRefSessionMessages, selectAtRefSessions } from './atRefStoreSelectors'

const session = (id: string, content: string): UiSession =>
  ({
    id,
    messages: [{ id: `${id}-message`, role: 'assistant', content }],
  }) as UiSession

test('autocomplete selectors stay dormant outside their matching mode', () => {
  const activeBefore = session('active', 'a')
  const surface = session('surface', 'stable')
  const before = { allSessions: [activeBefore, surface] }
  const after = { allSessions: [session('active', 'ab'), surface] }

  expect(selectAtRefSessionMessages(before, 'surface', true)).toBe(surface.messages)
  expect(selectAtRefSessionMessages(after, 'surface', true)).toBe(surface.messages)
  expect(selectAtRefSessionMessages(after, 'active', true)).not.toBe(activeBefore.messages)
  expect(selectAtRefSessionMessages(before, 'surface', false)).toBeUndefined()
  expect(selectAtRefSessionMessages(after, 'surface', false)).toBeUndefined()
  expect(selectAtRefSessions({ sessions: before.allSessions }, false)).toBe(
    selectAtRefSessions({ sessions: after.allSessions }, false),
  )
})
