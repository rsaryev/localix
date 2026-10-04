import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

await mock.module('./useChatPagePalette', () => ({
  useChatPagePalette: () => [],
}))

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

describe('useNewChatAction DOM boundary', () => {
  test('a button click cannot pass its MouseEvent as the conversation strategy', async () => {
    const React = await import('react')
    const { act, useRef } = React
    const { createRoot } = await import('react-dom/client')
    const { useNewChatAction } = await import('./useNewChatAction')
    const createSession = mock(async (_title?: string, _strategy?: unknown) => ({
      id: 'session-new',
      projectId: 'project-route',
    }))
    const goToSession = mock((_id: string, _options?: { project?: string }) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const startNewChatRef = useRef<() => void>(() => {})
      const { startNewChat } = useNewChatAction({
        isMobile: false,
        setSidebarOpen: () => {},
        routeProjectId: 'project-route',
        createSession: createSession as never,
        nav: { goToSession } as never,
        startNewChatRef,
        setProjectSwitcher: () => {},
        setSessionSwitcher: () => {},
      } as never)
      // React invokes this handler with a MouseEvent. `startNewChat` must deliberately ignore it.
      return (
        <button type="button" onClick={startNewChat}>
          New chat
        </button>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      await act(async () => host.querySelector('button')!.click())

      expect(createSession).toHaveBeenCalledTimes(1)
      expect(createSession.mock.calls[0]?.[1]).toEqual({
        scope: { kind: 'scope', projectId: 'project-route' },
        participant: { kind: 'inherit' },
      })
      expect(goToSession).toHaveBeenCalledWith('session-new', { project: 'project-route' })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
