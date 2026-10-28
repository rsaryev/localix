import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * Mounts the entries in the same dropdown the sidebar's "More options" button opens, with the
 * toggle wired to real state — what the sidebar does — so the test sees the row flip in place.
 */
async function mount(initial: boolean) {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } =
    await import('@localixai/kit/dropdown-menu')
  const { MenuEntries } = await import('@localixai/kit/menu-entries')
  const { fileTreeOptionsEntries } = await import('./fileTreeOptionsMenu')
  const flips: boolean[] = []
  function Harness() {
    const [compactEnabled, setCompact] = useState(initial)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">More options</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <MenuEntries
            family="dropdown"
            entries={fileTreeOptionsEntries({
              compactEnabled,
              toggleCompactEnabled: () =>
                setCompact((value) => {
                  flips.push(!value)
                  return !value
                }),
            })}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))
  return {
    flips,
    open: async () => {
      const trigger = host.querySelector<HTMLButtonElement>('button')!
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    row: () => document.querySelector<HTMLElement>('[role="menuitemcheckbox"]'),
    click: async (element: HTMLElement | null) => {
      expect(element).not.toBeNull()
      await act(async () => {
        element!.click()
        await settle()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('file tree options menu', () => {
  test('Compact folders is a checkbox toggle that flips in place without closing', async () => {
    const ui = await mount(true)
    try {
      await ui.open()
      const row = ui.row()
      expect(row?.textContent).toContain('Compact folders')
      expect(row?.getAttribute('aria-checked')).toBe('true')
      await ui.click(row)
      expect(ui.flips).toEqual([false])
      // Still open, and the same row now reads off.
      expect(ui.row()?.getAttribute('aria-checked')).toBe('false')
    } finally {
      await ui.unmount()
    }
  })
})
