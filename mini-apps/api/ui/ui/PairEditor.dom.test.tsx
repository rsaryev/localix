import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

describe('PairEditor variable completion', () => {
  test('keeps focus in the editor while exposing and accepting the active suggestion', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { PairEditor } = await import('./PairEditor')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [pairs, setPairs] = useState<Array<{ name: string; value: string }>>([])
      return (
        <PairEditor
          label="Headers"
          pairs={pairs}
          onChange={setPairs}
          variables={[
            { name: 'base_url', value: 'http://127.0.0.1:5051' },
            { name: 'token', value: 'local-token' },
          ]}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Headers value"]')!
      await act(async () => input.focus())
      await act(async () => setInputValue(input, '{{'))

      const list = document.body.querySelector<HTMLElement>(
        '[role="listbox"][aria-label="Headers variable suggestions"]',
      )!
      const options = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      const status = host.querySelector<HTMLElement>('[data-slot="result-count-status"]')!

      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-autocomplete')).toBe('list')
      expect(input.getAttribute('aria-haspopup')).toBe('listbox')
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id)
      expect(options).toHaveLength(2)
      expect(host.contains(list)).toBe(false)
      expect(list.parentElement?.hasAttribute('data-radix-popper-content-wrapper')).toBe(true)
      expect(list.className).not.toContain('absolute top-full')
      expect(options[0]?.getAttribute('aria-selected')).toBe('true')
      expect(list.querySelector('[role="option"] button')).toBeNull()
      expect(status.textContent?.trim()).toBe('2 suggestions')
      expect(list.contains(status)).toBe(false)
      expect(document.activeElement).toBe(input)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(options[1]?.getAttribute('aria-selected')).toBe('true')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id)
      expect(document.activeElement).toBe(input)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
      expect(input.value).toBe('{{token}}')
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
      expect(document.activeElement).toBe(input)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('materialises the trailing empty row and leaves another empty row ready', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { PairEditor } = await import('./PairEditor')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [pairs, setPairs] = useState<Array<{ name: string; value: string }>>([])
      return <PairEditor label="Query" showLabel pairs={pairs} onChange={setPairs} />
    }

    try {
      await act(async () => root.render(<Harness />))
      const first = host.querySelector<HTMLInputElement>('input[aria-label="Query name"]')!
      expect(first.placeholder).toBe('Add name')
      await act(async () => setInputValue(first, 'page'))

      const names = host.querySelectorAll<HTMLInputElement>('input[aria-label="Query name"]')
      expect(names).toHaveLength(2)
      expect(names[0]?.value).toBe('page')
      expect(names[1]?.placeholder).toBe('Add name')

      const table = host.querySelector('.group\\/pairs > div.overflow-hidden')!
      const bulk = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Bulk edit'),
      )!
      expect(table.compareDocumentPosition(bulk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
