import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resetActiveEventRoute, setActiveEventRoute } from './context'
import { startOpenChatRead } from './openChatRead'
import { pendingOps } from './outbox'
import {
  resetNotificationsForTests,
  seedNotificationsForTests,
  useNotificationsStore,
} from './store'
import type { NotificationInput } from './types'

const row = (id: string, sessionId: string | null): NotificationInput => ({
  id,
  topic: 'run.completed',
  category: 'agent',
  severity: 'success',
  title: `Run ${id}`,
  origin: sessionId ? { kind: 'session', sessionId, projectId: 'P1' } : { kind: 'application' },
})
const readIds = () =>
  useNotificationsStore
    .getState()
    .entries.filter((entry) => entry.read)
    .map((entry) => entry.id)
    .sort()

let stop: (() => void) | undefined
beforeEach(() => {
  resetNotificationsForTests()
  resetActiveEventRoute()
})
afterEach(() => {
  stop?.()
  stop = undefined
  resetNotificationsForTests()
  resetActiveEventRoute()
})

describe('opening a chat reads its events', () => {
  test('arriving at a chat reads what was waiting for it there, and nothing else', () => {
    seedNotificationsForTests([row('a', 'S1'), row('b', 'S2'), row('c', null)])
    stop = startOpenChatRead()
    expect(readIds()).toEqual([])

    setActiveEventRoute('/project/P1/S1')
    expect(readIds()).toEqual(['a'])
    // The read reaches the server, so every window agrees.
    expect(pendingOps()).toContainEqual(expect.objectContaining({ op: 'read', keys: ['a'] }))
  })

  test('rows that land after the chat opened are read too — the first sync after a launch', () => {
    setActiveEventRoute('/project/P1/S1')
    stop = startOpenChatRead()
    seedNotificationsForTests([row('late', 'S1'), row('other', 'S2')])
    expect(readIds()).toEqual(['late'])
  })
})
