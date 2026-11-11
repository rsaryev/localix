import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { TerminalFolderMoved } from './TerminalPaneStatus'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('a terminal whose project moved says where, and restarts there on a click', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const restart = mock(() => {})
  const host = document.createElement('div')
  const root = createRoot(host)
  await React.act(async () =>
    root.render(
      <TerminalFolderMoved
        moved={{ from: '/work/kit', to: '/work/llx', cwd: '/work/llx/app' }}
        onRestart={restart}
      />,
    ),
  )
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    'This terminal is still in /work/kit, which moved to /work/llx.',
  )
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Restart in “llx”'),
  )
  expect(button?.title).toBe('/work/llx/app')
  await React.act(async () => button?.click())
  expect(restart).toHaveBeenCalledTimes(1)
  await React.act(async () => root.unmount())
})
