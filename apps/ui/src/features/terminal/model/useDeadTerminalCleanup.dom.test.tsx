import { afterAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { emptyEditorState, useGridStore } from '@/features/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { useDeadTerminalCleanup } from './useDeadTerminalCleanup'

const teardown = registerDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(teardown)

function Workspace() {
  useDeadTerminalCleanup()
  return <p>Workspace</p>
}

test('the workspace retains hidden terminal tabs on exit and releases its subscriptions', async () => {
  const original = useGridStore.getState()
  useGridStore.setState(emptyEditorState('test-group'))
  useGridStore.getState().openItem({
    id: 'terminal:dead',
    kind: 'terminal',
    title: 'Hidden agent',
    scope: 'hidden-conversation',
    payload: { terminalId: 'dead', sessionId: 'hidden-conversation', owned: false },
  })
  let event!: Parameters<typeof eventSocket.onSessionEvent>[0]
  const dispose = spyOn({ dispose() {} }, 'dispose')
  const subscribe = spyOn(eventSocket, 'onSessionEvent').mockImplementation((handler) => {
    event = handler
    return dispose
  })
  const reconnect = spyOn(eventSocket, 'onReconnect').mockReturnValue(() => {})
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([{ id: 'dead' }] as never)
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Workspace />))
    expect(useGridStore.getState().items['terminal:dead']).toBeDefined()
    await act(async () => {
      event('hidden-conversation', {
        type: 'terminal.finished',
        sessionId: 'hidden-conversation',
        terminalId: 'dead',
        exitCode: 1,
      })
    })
    expect(useGridStore.getState().items['terminal:dead']?.payload?.terminalExit).toMatchObject({
      exitCode: 1,
    })
    expect(useGridStore.getState().closed).toEqual([])
    expect(host.textContent).toBe('Workspace')
    await act(async () => root.unmount())
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    subscribe.mockRestore()
    reconnect.mockRestore()
    list.mockRestore()
    dispose.mockRestore()
    useGridStore.setState(original)
  }
})
