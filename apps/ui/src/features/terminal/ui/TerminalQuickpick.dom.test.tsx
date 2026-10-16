import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

async function mountQuickpick(items: string[]) {
  const { createRoot } = await import('react-dom/client')
  const { TerminalQuickpick } = await import('./TerminalQuickpick')
  const chosen: string[] = []
  let closed = 0
  const pane = document.createElement('div')
  pane.className = 'relative'
  document.body.append(pane)
  const root = createRoot(pane)

  await act(async () => {
    root.render(
      <TerminalQuickpick
        items={items}
        filter={(values) => values}
        placeholder="Choose command"
        ariaLabel="Command choices"
        emptyText="No commands"
        renderRow={(item) => item}
        onChoose={(item) => chosen.push(item)}
        onClose={() => {
          closed += 1
        }}
      />,
    )
  })

  return {
    pane,
    chosen,
    get closed() {
      return closed
    },
    dispose: async () => {
      await act(async () => root.unmount())
      pane.remove()
    },
  }
}

describe('TerminalQuickpick keyboard behavior', () => {
  test('moves the active option and chooses it without moving DOM focus', async () => {
    const view = await mountQuickpick(['Build', 'Test'])
    try {
      const input = view.pane.querySelector<HTMLInputElement>('input')!
      const options = view.pane.querySelectorAll('[role="option"]')
      const list = view.pane.querySelector<HTMLElement>('[role="listbox"]')!
      const status = view.pane.querySelector<HTMLElement>('[data-slot="result-count-status"]')!
      expect(input.getAttribute('aria-autocomplete')).toBe('list')
      expect(input.getAttribute('aria-haspopup')).toBe('listbox')
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(status.textContent?.trim()).toBe('2 results')
      expect(list.contains(status)).toBe(false)
      expect(document.activeElement).toBe(input)
      expect(options[0]?.getAttribute('aria-selected')).toBe('true')

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(options[1]?.getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(input)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(view.chosen).toEqual(['Test'])
    } finally {
      await view.dispose()
    }
  })

  test('keeps an empty list at a valid index and lets the dialog own Escape', async () => {
    const view = await mountQuickpick([])
    try {
      const input = view.pane.querySelector<HTMLInputElement>('input')!
      const status = view.pane.querySelector<HTMLElement>('[data-slot="result-count-status"]')!
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
      expect(status.textContent?.trim()).toBe('0 results')

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
      expect(view.chosen).toEqual([])

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(view.closed).toBe(1)
    } finally {
      await view.dispose()
    }
  })
})
