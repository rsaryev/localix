import { afterEach, beforeEach, expect, jest, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { withoutQueuedUserMessages } from './queuedUserMessages'
import { REVEAL_IDLE_SEND_MS, sendChatMessage } from './sendChatMessage'
import { useChatStore } from './store'

let originalState: ReturnType<typeof useChatStore.getState>
let sendSpy: { mockRestore: () => void } | undefined

const seed = (isRunning: boolean) => {
  const session = {
    id: 's1',
    projectId: 'project-a',
    messages: [],
    isRunning,
    queuedMessages: [],
  } as unknown as UiSession
  useChatStore.setState({
    sessions: [session],
    allSessions: [session],
    activeSessionId: 's1',
    activeProjectId: 'project-a',
  })
}

const transcript = () => {
  const session = useChatStore.getState().sessions[0]!
  return withoutQueuedUserMessages(session.messages, session.queuedMessages)
}

beforeEach(() => {
  originalState = useChatStore.getState()
})
afterEach(() => {
  sendSpy?.mockRestore()
  sendSpy = undefined
  useChatStore.setState(originalState, true)
})

test('a message sent during a run is not in the transcript at any frame, queued or not yet told', async () => {
  seed(true)
  let settle!: (value: { sessionId: string; messageId: string; queued: true }) => void
  sendSpy = spyOn(backendClient, 'sendMessage').mockImplementation(
    () => new Promise((resolve) => (settle = resolve)),
  )
  const sending = sendChatMessage('s1', 'while you work')
  expect(transcript()).toEqual([])
  settle({ sessionId: 's1', messageId: '', queued: true as const })
  await sending
  expect(transcript()).toEqual([])
})

test('a send that finds the run already over joins the transcript once the server says so', async () => {
  seed(true)
  sendSpy = spyOn(backendClient, 'sendMessage').mockResolvedValue({
    sessionId: 's1',
    messageId: 'm1',
  })
  await sendChatMessage('s1', 'late')
  expect(transcript().map((m) => m.content)).toEqual(['late'])
})

/** Every frame of the person's own lines the person could have seen while a send was in flight. */
const watchTranscript = () => {
  const frames: string[][] = []
  const record = () =>
    frames.push(
      transcript()
        .filter((m) => m.role === 'user')
        .map((m) => m.content ?? ''),
    )
  record()
  const stop = useChatStore.subscribe(record)
  return { frames, stop }
}

test('a send the client thought idle, that the server queues, never flashes in the transcript', async () => {
  seed(false)
  let settle!: (value: { sessionId: string; messageId: string; queued: true }) => void
  sendSpy = spyOn(backendClient, 'sendMessage').mockImplementation(
    () => new Promise((resolve) => (settle = resolve)),
  )
  const watch = watchTranscript()
  const sending = sendChatMessage('s1', 'busy after all')
  settle({ sessionId: 's1', messageId: '', queued: true as const })
  await sending
  watch.stop()
  expect(watch.frames.flat()).toEqual([])
})

test('a send on an idle session shows once the server says the turn started', async () => {
  seed(false)
  let settle!: (value: { sessionId: string; messageId: string }) => void
  sendSpy = spyOn(backendClient, 'sendMessage').mockImplementation(
    () => new Promise((resolve) => (settle = resolve)),
  )
  const sending = sendChatMessage('s1', 'hello')
  settle({ sessionId: 's1', messageId: 'm1' })
  await sending
  expect(transcript().map((m) => m.content)).toEqual(['hello'])
})

test('a send on an idle session does not wait for a slow answer to show', async () => {
  jest.useFakeTimers()
  try {
    seed(false)
    sendSpy = spyOn(backendClient, 'sendMessage').mockImplementation(() => new Promise(() => {}))
    void sendChatMessage('s1', 'hello')
    jest.advanceTimersByTime(REVEAL_IDLE_SEND_MS)
    expect(transcript().map((m) => m.content)).toEqual(['hello'])
  } finally {
    jest.useRealTimers()
  }
})
