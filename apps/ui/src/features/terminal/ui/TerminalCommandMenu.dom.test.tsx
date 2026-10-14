import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act, useState } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

async function mountMenu(input: { command: string; output: string }) {
  const { createRoot } = await import('react-dom/client')
  const { TerminalCommandMenu } = await import('./TerminalCommandMenu')
  const calls: string[] = []
  let closed = 0

  function Harness() {
    const [open, setOpen] = useState(true)
    return open ? (
      <TerminalCommandMenu
        state={{ x: 123, y: 234, command: input.command, output: input.output, fixes: [] }}
        onCopyCommand={() => calls.push('copy-command')}
        onCopyOutput={() => calls.push('copy-output')}
        onCopyBoth={() => calls.push('copy-both')}
        onRerun={() => calls.push('rerun')}
        onRunFix={() => calls.push('fix')}
        onClose={() => {
          closed += 1
          setOpen(false)
        }}
      />
    ) : null
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))

  return {
    host,
    calls,
    get closed() {
      return closed
    },
    dispose: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('TerminalCommandMenu', () => {
  test('anchors at the xterm coordinate and skips unavailable actions during keyboard travel', async () => {
    const view = await mountMenu({ command: '', output: 'build output' })
    try {
      const menu = document.body.querySelector<HTMLElement>(
        '[role="menu"][aria-label="Terminal command actions"]',
      )!
      const anchor = document.body.querySelector<HTMLElement>('[data-slot="popover-anchor"]')!
      const copyCommand = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === 'Copy command',
      )!
      const copyOutput = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === 'Copy output',
      )!
      const copyBoth = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === 'Copy command + output',
      )!

      expect(anchor.style.left).toBe('123px')
      expect(anchor.style.top).toBe('234px')
      expect(copyCommand.disabled).toBe(true)
      expect(document.activeElement).toBe(copyOutput)

      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(document.activeElement).toBe(copyBoth)

      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(document.activeElement).toBe(copyOutput)
    } finally {
      await view.dispose()
    }
  })

  test('supports Home, End and typeahead, then runs one action and dismisses', async () => {
    const view = await mountMenu({ command: 'bun test', output: 'ok' })
    try {
      const menu = document.body.querySelector<HTMLElement>(
        '[role="menu"][aria-label="Terminal command actions"]',
      )!
      const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]

      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      })
      expect(document.activeElement?.textContent?.trim()).toBe('Rerun')

      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
      })
      const rerun = items.find((item) => item.textContent?.trim() === 'Rerun')!
      expect(document.activeElement).toBe(rerun)

      await act(async () => rerun.click())
      expect(view.calls).toEqual(['rerun'])
      expect(view.closed).toBe(1)
      expect(document.body.querySelector('[aria-label="Terminal command actions"]')).toBeNull()
    } finally {
      await view.dispose()
    }
  })

  test('dismisses on Escape without running an action', async () => {
    const view = await mountMenu({ command: 'bun test', output: 'ok' })
    try {
      const menu = document.body.querySelector<HTMLElement>(
        '[role="menu"][aria-label="Terminal command actions"]',
      )!
      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(view.calls).toEqual([])
      expect(view.closed).toBe(1)
    } finally {
      await view.dispose()
    }
  })
})
