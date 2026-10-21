import { expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import { pruneFinishedSubSessions } from './sessionListHelpers'

test('the overall cap bounds running children while retaining root chats and row identities', () => {
  const row = (id: string, updatedAt: number, sessionKind: UiSession['sessionKind']) =>
    ({ id, updatedAt, sessionKind, isRunning: true }) as UiSession
  const root = row('root', 0, 'chat')
  const oldest = row('oldest-child', 1, 'subagent')
  const newest = row('newest-child', 3, 'job')
  const middle = row('middle-child', 2, 'subagent')
  const all = [root, oldest, newest, middle]

  const retained = pruneFinishedSubSessions(all, 25, 2)

  expect(retained).toEqual([root, newest, middle])
  expect(retained[0]).toBe(root)
  expect(retained[1]).toBe(newest)
  expect(retained[2]).toBe(middle)
  expect(all).toEqual([root, oldest, newest, middle])
  expect(pruneFinishedSubSessions(retained, 25, 2)).toBe(retained)
})
