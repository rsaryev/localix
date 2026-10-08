import { afterAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { emptyEditorState, useGridStore } from '@/features/workspace-grid/model'
import { TerminalExitNotice } from './TerminalExitNotice'

const teardown = registerDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(teardown)

test('announces the exit code and lets the person close the retained tab', async () => {
  const original = useGridStore.getState()
  useGridStore.setState(emptyEditorState('test-group'))
  useGridStore
    .getState()
    .openItem({ id: 'terminal:failed', kind: 'terminal', title: 'Build', scope: 's1' })
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(<TerminalExitNotice paneId="terminal:failed" exit={{ exitCode: 1 }} />),
    )
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Process exited with code 1.')
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['Restart', 'Close'])
    await act(async () => buttons[1]!.click())
    expect(useGridStore.getState().items['terminal:failed']).toBeUndefined()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    useGridStore.setState(original)
  }
})
