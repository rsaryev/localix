import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { registerAgentRunPreflight } from '@/shared/api/agentRunPreflight'
import { eventSocket } from '@/shared/api/eventSocket'
import type { UiSession } from '@/shared/api/contracts'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { waitForRuntimeCapabilities } from '@/features/settings/model/runtimeCapabilityReadiness'
import { sendChatMessage } from './sendChatMessage'
import { useChatStore } from './store'

let originalState: ReturnType<typeof useChatStore.getState>
let sendSpy: { mockRestore: () => void } | undefined

beforeEach(() => {
  originalState = useChatStore.getState()
  const session = {
    id: 's1',
    projectId: 'project-a',
    messages: [],
    isRunning: true,
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
  sendSpy?.mockRestore()
  sendSpy = undefined
  useChatStore.setState(originalState, true)
})

describe('optimistic send rollback', () => {
  test('a failed queued send does not mark the pre-existing run idle', async () => {
    sendSpy = spyOn(backendClient, 'sendMessage').mockRejectedValue(new Error('offline'))

    await sendChatMessage('s1', 'this send fails').catch(() => {})

    expect(useChatStore.getState().sessions[0]!.isRunning).toBe(true)
  })

  test('concurrent failures clear an idle session only after the last request settles', async () => {
    useChatStore.getState()._setSessionRunning('s1', false)
    let rejectFirst!: (reason: Error) => void
    let rejectSecond!: (reason: Error) => void
    sendSpy = spyOn(backendClient, 'sendMessage')
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSecond = reject
          }),
      )

    const first = sendChatMessage('s1', 'first')
    const second = sendChatMessage('s1', 'second')
    rejectFirst(new Error('first failed'))
    await first.catch(() => {})
    expect(useChatStore.getState().sessions[0]!.isRunning).toBe(true)

    rejectSecond(new Error('second failed'))
    await second.catch(() => {})
    expect(useChatStore.getState().sessions[0]!.isRunning).toBe(false)
  })

  test('one accepted concurrent send keeps the shared running lead after its sibling fails', async () => {
    useChatStore.getState()._setSessionRunning('s1', false)
    let rejectSecond!: (reason: Error) => void
    sendSpy = spyOn(backendClient, 'sendMessage')
      .mockResolvedValueOnce({ sessionId: 's1', messageId: 'm1' })
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSecond = reject
          }),
      )

    const accepted = sendChatMessage('s1', 'accepted')
    const failed = sendChatMessage('s1', 'failed')
    await accepted
    rejectSecond(new Error('second failed'))
    await failed.catch(() => {})

    expect(useChatStore.getState().sessions[0]!.isRunning).toBe(true)
  })

  test('a failed later send does not remove an earlier accepted queued message', () => {
    const store = useChatStore.getState()
    const accepted = store._appendOptimisticSend('s1', 'accepted and queued')
    const failed = store._appendOptimisticSend('s1', 'failed before acceptance')

    useChatStore.getState()._dropOptimistic('s1', failed)

    const messages = useChatStore.getState().sessions[0]!.messages
    expect(messages.map((message) => message.content)).toEqual(['accepted and queued'])
    expect(messages.map((message) => message.id)).toEqual([accepted.userId])
  })

  test('an unscoped edit rollback still clears every unclaimed placeholder', () => {
    const store = useChatStore.getState()
    store._appendOptimisticSend('s1', 'first')
    store._appendOptimisticSend('s1', 'second')

    useChatStore.getState()._dropOptimistic('s1')

    expect(useChatStore.getState().sessions[0]!.messages).toEqual([])
  })

  test('a queued response keeps the user row but removes an idle-race assistant skeleton', async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === 's1' ? { ...session, isRunning: false } : session,
      ),
      allSessions: state.allSessions.map((session) =>
        session.id === 's1' ? { ...session, isRunning: false } : session,
      ),
    }))
    sendSpy = spyOn(backendClient, 'sendMessage').mockResolvedValue({
      sessionId: 's1',
      messageId: '',
      queued: true,
    })

    await sendChatMessage('s1', 'queued during the stop race')

    const session = useChatStore.getState().sessions[0]!
    expect(session.messages.map((message) => message.role)).toEqual(['user'])
    expect(session.messages[0]).toMatchObject({
      content: 'queued during the stop race',
      optimistic: true,
    })
    expect(session.streamingMessageId).toBeNull()
  })

  test('passes the optimistic user identity into the backend queue contract', async () => {
    sendSpy = spyOn(backendClient, 'sendMessage').mockResolvedValue({
      sessionId: 's1',
      messageId: '',
      queued: true,
    })

    await sendChatMessage('s1', 'correlate me')

    const optimisticUser = useChatStore
      .getState()
      .sessions[0]!.messages.find((message) => message.role === 'user')!
    expect(sendSpy).toHaveBeenCalledWith(
      's1',
      'correlate me',
      undefined,
      undefined,
      optimisticUser.id,
      'project-a',
    )
  })

  test('binds a warm out-of-scope send to the owning project catalog', async () => {
    const warm = {
      id: 'warm',
      projectId: 'project-b',
      messages: [],
      isRunning: false,
      queuedMessages: [],
    } as unknown as UiSession
    useChatStore.setState((state) => ({
      sessions: state.sessions,
      allSessions: [...state.allSessions, warm],
    }))
    sendSpy = spyOn(backendClient, 'sendMessage').mockResolvedValue({
      sessionId: 'warm',
      messageId: 'message',
    })

    await sendChatMessage('warm', 'from a plugin panel')

    expect(sendSpy).toHaveBeenCalledWith(
      'warm',
      'from a plugin panel',
      undefined,
      undefined,
      expect.any(String),
      'project-b',
    )
  })

  test('waits for the owning project tool-availability save before sending', async () => {
    const unregister = registerAgentRunPreflight(waitForRuntimeCapabilities)
    const guarded = {
      id: 'guarded',
      projectId: 'project-tool-barrier',
      messages: [],
      isRunning: false,
      queuedMessages: [],
    } as unknown as UiSession
    useChatStore.setState((state) => ({
      sessions: [...state.sessions, guarded],
      allSessions: [...state.allSessions, guarded],
    }))
    let release!: () => void
    // A tool switch the user just made, still in flight: the send below must wait for
    // it rather than assemble a run that still carries the tool.
    const toggle = spyOn(backendClient, 'applyCapabilityRules').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              revision: 1,
              scope: { projectId: guarded.projectId!, sessionId: null },
            } as never)
        }),
    )
    const mutation = applyCapabilityRules(guarded.projectId!, [
      availabilityChange('tool', 'localix_ui', false),
    ])
    const requestSpy = spyOn(eventSocket, 'request').mockResolvedValue({
      sessionId: guarded.id,
      messageId: 'message',
    })

    const sending = sendChatMessage(guarded.id, 'respect the latest tool policy')
    expect(requestSpy).not.toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
    expect(requestSpy).not.toHaveBeenCalled()

    release()
    await mutation
    await sending
    expect(requestSpy).toHaveBeenCalledTimes(1)
    requestSpy.mockRestore()
    toggle.mockRestore()
    unregister()
  })

  test('an already-visible server queue never paints a second assistant skeleton', () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === 's1'
          ? {
              ...session,
              isRunning: false,
              queuedMessages: [
                {
                  id: 'q1',
                  kind: 'user',
                  priority: 0,
                  preview: 'first',
                  queuedAt: '2026-07-25T00:00:00.000Z',
                },
              ],
            }
          : session,
      ),
      allSessions: state.allSessions,
    }))

    useChatStore.getState()._appendOptimisticSend('s1', 'second')

    expect(useChatStore.getState().sessions[0]!.messages.map((message) => message.role)).toEqual([
      'user',
    ])
  })

  test('plugin lifecycle commands paint a tool-style activity row instead of an assistant skeleton', () => {
    useChatStore.getState()._setSessionRunning('s1', false)

    useChatStore.getState()._appendOptimisticSend('s1', '/plugin install owner/review')

    const messages = useChatStore.getState().sessions[0]!.messages
    expect(messages.map((message) => message.role)).toEqual(['user', 'system'])
    expect(messages[1]?.commandOutput).toMatchObject({
      command: '/plugin',
      tone: 'neutral',
      activity: {
        kind: 'plugin',
        action: 'install',
        state: 'running',
        label: 'Installing plugin',
        subject: 'owner/review',
      },
    })
  })
})
