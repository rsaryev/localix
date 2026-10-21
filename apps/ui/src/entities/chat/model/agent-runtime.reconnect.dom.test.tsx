import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { eventSocket } from '@/shared/api/eventSocket'
import { registerDom } from '@localixai/kit/testing/dom'
import { useChatEventStream } from './agent-runtime'
import { useChatStore } from './store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const body = (id: string, over: Partial<UiSession> = {}) =>
  ({ id, messages: [], isRunning: false, bodyLoaded: true, ...over }) as unknown as UiSession

describe('useChatEventStream reconnect', () => {
  // A background grid tab that was streaming when the API restarted kept its half-streamed body:
  // the reconnect refetched only the active session, and the frames that would have finished the
  // tab's run are live-only.
  test('resyncs the watched background sessions, not only the active one', async () => {
    let reconnect: (() => void) | undefined
    const spies = [
      spyOn(eventSocket, 'onSessionEvent').mockImplementation(() => () => {}),
      spyOn(eventSocket, 'onReconnect').mockImplementation((handler) => {
        reconnect = handler as () => void
        return () => {}
      }),
      spyOn(eventSocket, 'watchedSessionIds').mockImplementation(() => ['active', 'grid']),
      spyOn(backendClient, 'listAttention').mockResolvedValue([]),
      spyOn(backendClient, 'listSessions').mockResolvedValue([]),
    ]
    const getSession = spyOn(backendClient, 'getSession').mockImplementation(async (id) => body(id))
    const before = useChatStore.getState()
    useChatStore.setState({
      activeSessionId: 'active',
      sessions: [body('active'), body('grid', { isRunning: true })],
    })

    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    function Host() {
      useChatEventStream()
      return null
    }
    try {
      await React.act(async () => root.render(<Host />))
      await React.act(async () => {
        reconnect?.()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      // What the fetched body does to the store is `reconnect-watched.test.ts`'s and
      // `mergeSessionBody`'s concern; this pins that the reconnect asks for it at all.
      const fetched = getSession.mock.calls.map(([id]) => id)
      expect(fetched.sort()).toEqual(['active', 'grid'])
    } finally {
      await React.act(async () => root.unmount())
      useChatStore.setState({
        activeSessionId: before.activeSessionId,
        sessions: before.sessions,
      })
      getSession.mockRestore()
      for (const spy of spies) spy.mockRestore()
    }
  })
})
