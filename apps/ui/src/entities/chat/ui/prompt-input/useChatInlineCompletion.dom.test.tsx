import { afterAll, afterEach, beforeAll, expect, jest, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import * as inlineCompletion from '@/shared/hooks/useInlineCompletion'
import type { UiSession } from '@/shared/api/contracts'
import { REPLY_PREDICTION_DELAY_MS } from './replyPrediction'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => jest.useRealTimers())

const NOW = Date.parse('2026-07-26T12:00:00Z')

/** One conversation whose last row is the agent's words, written `ageMs` ago. */
const sessionWith = (ageMs: number): UiSession =>
  ({
    id: 's1',
    projectId: 'p1',
    updatedAt: 1,
    queuedMessages: [],
    pendingInteraction: null,
    messages: [
      {
        id: 'reply-1',
        role: 'assistant',
        content: 'Done. Shall I run the tests?',
        createdAt: new Date(NOW - ageMs).toISOString(),
      },
    ],
  }) as unknown as UiSession

/** Mount the hook on an empty composer and report what it asks the shared completion to do. */
async function mount(session: UiSession) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatStore } = await import('../../model/store')
  const { useChatInlineCompletion } = await import('./useChatInlineCompletion')
  useChatStore.setState({ activeProjectId: 'p1', sessions: [session], allSessions: [session] })
  const asked = spyOn(inlineCompletion, 'useInlineCompletion').mockImplementation(
    () => ({}) as never,
  )
  function Probe() {
    useChatInlineCompletion({
      prompt: '',
      setPrompt: () => {},
      sessionId: 's1',
      completionRefs: [],
      enabled: true,
      active: true,
      generating: false,
      focused: false,
      caretAtEnd: false,
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(<Probe />))
  const latest = () => asked.mock.calls.at(-1)![0]
  return { act: React.act, latest, unmount: () => React.act(async () => root.unmount()) }
}

test('an empty composer predicts the reply only after the pause that follows the settled message', async () => {
  jest.useFakeTimers({ now: NOW })
  const ui = await mount(sessionWith(1_000))
  try {
    expect(ui.latest().active).toBe(false)
    await ui.act(async () => void jest.advanceTimersByTime(REPLY_PREDICTION_DELAY_MS - 1))
    expect(ui.latest().active).toBe(false)
    await ui.act(async () => void jest.advanceTimersByTime(1))
    expect(ui.latest()).toMatchObject({
      active: true,
      focused: true,
      caretAtEnd: true,
      debounceMs: 0,
    })
  } finally {
    await ui.unmount()
  }
})

test('an old conversation opened to be read never predicts a reply', async () => {
  jest.useFakeTimers({ now: NOW })
  const ui = await mount(sessionWith(60 * 60_000))
  try {
    await ui.act(async () => void jest.advanceTimersByTime(REPLY_PREDICTION_DELAY_MS * 4))
    expect(ui.latest().active).toBe(false)
  } finally {
    await ui.unmount()
  }
})
