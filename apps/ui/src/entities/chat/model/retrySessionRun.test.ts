import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { ApiError } from '@/shared/api/failure'
import { useNotificationsStore } from '@/shared/lib/notifications/store'
import { retrySessionRun } from './retrySessionRun'
import { useChatStore } from './store'

let originalState: ReturnType<typeof useChatStore.getState>

beforeEach(() => {
  originalState = useChatStore.getState()
  const session = {
    id: 'retry-session',
    projectId: 'project-a',
    messages: [],
    isRunning: false,
    queuedMessages: [],
  } as unknown as UiSession
  useChatStore.setState({
    sessions: [session],
    allSessions: [session],
    activeSessionId: session.id,
    activeProjectId: 'project-a',
  })
})

afterEach(() => {
  useChatStore.setState(originalState, true)
})

describe('retry session run', () => {
  test('a late recovery snapshot cannot overwrite newer stream state', async () => {
    const stale = useChatStore.getState().sessions[0]!
    let resolveSnapshot!: (session: UiSession) => void
    const regenerate = spyOn(backendClient, 'regenerate').mockRejectedValue(new Error('offline'))
    const getSession = spyOn(backendClient, 'getSession').mockImplementation(
      () =>
        new Promise<UiSession>((resolve) => {
          resolveSnapshot = resolve
        }),
    )
    try {
      expect(await retrySessionRun('retry-session', 'project-a')).toBe('failed')
      useChatStore.getState()._setSessionRunning('retry-session', true)
      const current = useChatStore.getState().sessions[0]
      resolveSnapshot(stale)
      await Promise.resolve()
      await Promise.resolve()
      expect(useChatStore.getState().sessions[0]).toBe(current)
      expect(current?.isRunning).toBe(true)
    } finally {
      regenerate.mockRestore()
      getSession.mockRestore()
    }
  })

  test('keeps the optimistic running lead after the backend accepts the retry', async () => {
    const regenerate = spyOn(backendClient, 'regenerate').mockResolvedValue({
      sessionId: 'retry-session',
      messageId: 'message',
    })

    expect(await retrySessionRun('retry-session', 'project-a', 'failed-reply')).toBe('accepted')
    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(true)
    // The reply this retry is for travels to the server, which refuses if a newer one came after it.
    expect(regenerate).toHaveBeenCalledWith('retry-session', 'project-a', 'failed-reply')
    regenerate.mockRestore()
  })

  test('a server refusal is an answer, not a failure: no error row', async () => {
    const regenerate = spyOn(backendClient, 'regenerate').mockRejectedValue(
      new ApiError('That reply is no longer the latest one', 409, 'regenerate_superseded'),
    )
    const before = useNotificationsStore.getState().entries.length
    expect(await retrySessionRun('retry-session', 'project-a', 'old')).toBe('superseded')
    expect(useNotificationsStore.getState().entries.length).toBe(before)
    regenerate.mockRestore()
  })

  test('clears the running lead when policy persistence or the retry request fails', async () => {
    const regenerate = spyOn(backendClient, 'regenerate').mockRejectedValue(new Error('offline'))
    const getSession = spyOn(backendClient, 'getSession').mockRejectedValue(new Error('offline'))

    expect(await retrySessionRun('retry-session', 'project-a')).toBe('failed')
    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(false)
    expect(getSession).toHaveBeenCalledWith('retry-session')
    regenerate.mockRestore()
    getSession.mockRestore()
  })

  test('files a failed retry under the chat it retried, whatever is on screen', async () => {
    const { resetNotificationsForTests, useNotificationsStore } =
      await import('@/shared/lib/notifications/store')
    resetNotificationsForTests()
    const regenerate = spyOn(backendClient, 'regenerate').mockRejectedValue(new Error('offline'))
    const getSession = spyOn(backendClient, 'getSession').mockRejectedValue(new Error('offline'))
    try {
      useChatStore.setState({ activeSessionId: null })
      await retrySessionRun('retry-session', 'project-a')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(useNotificationsStore.getState().entries[0]).toMatchObject({
        title: 'Could not retry the agent run',
        origin: { kind: 'session', sessionId: 'retry-session', projectId: 'project-a' },
      })
    } finally {
      regenerate.mockRestore()
      getSession.mockRestore()
      resetNotificationsForTests()
    }
  })
})
