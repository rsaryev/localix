import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import { useChatStore } from './store'

/**
 * A session write does not patch the store with its own response: the server publishes the stored
 * session as `session.updated`, and that frame is the one writer every surface shares (P12).
 */
const session = (patch: Partial<UiSession> = {}) =>
  ({
    id: 's1',
    title: 'Old',
    isPinned: false,
    isArchived: false,
    projectId: null,
    agents: [],
    messages: [],
    updatedAt: 1,
    revision: '2026-10-01T00:00:00.000Z',
    ...patch,
  }) as unknown as UiSession

const before = useChatStore.getState()
afterEach(() => {
  useChatStore.setState({ sessions: before.sessions, allSessions: before.allSessions })
})

describe('session writes reach the store through the stream', () => {
  test('rename and pin leave the store to the session.updated frame', async () => {
    useChatStore.setState({ sessions: [session()], allSessions: [session()] })
    const update = spyOn(backendClient, 'updateSession').mockImplementation(
      async (_id, patch) => session(patch as Partial<UiSession>) as never,
    )
    try {
      await useChatStore.getState().renameSession('s1', 'New')
      await useChatStore.getState().togglePinSession('s1')
      expect(update).toHaveBeenCalledTimes(2)
      expect(useChatStore.getState().allSessions[0]?.title).toBe('Old')

      useChatStore.getState()._applyStreamEvent('s1', {
        type: 'session.updated',
        session: {
          ...session({ title: 'New', isPinned: true }),
          updatedAt: '2026-10-02T00:00:00.000Z',
        },
      } as unknown as AgentStreamEvent)
      const stored = useChatStore.getState().allSessions.find((s) => s.id === 's1')
      expect(stored?.title).toBe('New')
      expect(stored?.isPinned).toBe(true)
    } finally {
      update.mockRestore()
    }
  })
})
