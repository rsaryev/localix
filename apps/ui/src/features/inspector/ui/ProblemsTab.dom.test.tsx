import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import type { LspDiagnostic, UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/entities/chat/model/store'
import { inspector } from '@/shared/lib/inspectorBus'
import { ProblemsTab } from './ProblemsTab'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function diagnostic(message: string, line: number): LspDiagnostic {
  return {
    message,
    severity: 1,
    range: { start: { line, character: 2 }, end: { line, character: 6 } },
  } as LspDiagnostic
}

function session(id: string, file: string, message: string): UiSession {
  return {
    id,
    title: id,
    createdAt: 1,
    lspServers: [],
    lspDiagnostics: { [file]: [diagnostic(message, 4)] },
  } as unknown as UiSession
}

// The Problems tab is one per chat. It used to read the chat on screen, so a kept-alive tab of
// chat A listed B's diagnostics and opened B's files as soon as the person switched to B.
describe('Problems tab ownership', () => {
  test("lists and opens its own chat's problems while another chat is on screen", async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const original = useChatStore.getState()
    const open = spyOn(inspector, 'openFile').mockImplementation(() => {})
    useChatStore.setState({
      allSessions: [
        session('problems-a', '/a/owned.ts', 'error owned by A'),
        session('problems-b', '/b/foreign.ts', 'error owned by B'),
      ],
      activeSessionId: 'problems-b',
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="problems-a">
            <ProblemsTab />
          </WorkItemSessionProvider>,
        ),
      )
      expect(host.textContent).toContain('error owned by A')
      expect(host.textContent).not.toContain('error owned by B')

      const row = host.querySelector<HTMLElement>('[title="Error: error owned by A"]')!
      await act(async () => row.click())
      expect(open.mock.calls).toEqual([
        [
          {
            sessionId: 'problems-a',
            path: '/a/owned.ts',
            line: 5,
            column: 2,
            endLine: 5,
            endColumn: 6,
          },
        ],
      ])
    } finally {
      await act(async () => root.unmount())
      host.remove()
      open.mockRestore()
      useChatStore.setState({
        allSessions: original.allSessions,
        activeSessionId: original.activeSessionId,
      })
    }
  })
})
