import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

test('the rows are read from the terminal when the menu opens, not when the pane renders', async () => {
  const { createRoot } = await import('react-dom/client')
  const { ContextMenu, ContextMenuContent, ContextMenuTrigger } =
    await import('@localixai/kit/context-menu')
  const { TerminalContextMenuEntries } = await import('./TerminalContextMenuEntries')

  let selection = ''
  const build = () => [
    { id: 'copy', label: 'Copy', disabled: selection.length === 0, onSelect: () => {} },
  ]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const pane = () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div data-testid="terminal">terminal</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <TerminalContextMenuEntries build={build} />
      </ContextMenuContent>
    </ContextMenu>
  )
  try {
    await act(async () => root.render(pane()))
    // The person selects text in xterm: React is not told, so the pane does not render again.
    selection = 'git status'
    await act(async () => {
      host.querySelector('[data-testid="terminal"]')!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 4,
          clientY: 4,
        }),
      )
    })
    const copy = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Copy',
    )
    expect(copy).toBeDefined()
    expect(copy!.getAttribute('aria-disabled')).toBeNull()
    expect(copy!.hasAttribute('data-disabled')).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
