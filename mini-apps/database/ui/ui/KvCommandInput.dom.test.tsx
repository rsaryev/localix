import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

describe('Redis command autocomplete', () => {
  test('keeps input focus, exposes the active option, and distinguishes accept from run', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { KvCommandInput } = await import('./KvConsole')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const runs: string[] = []
    let setValueFromOutside: (value: string) => void = () => {}

    function Harness() {
      const [value, setValue] = useState('')
      React.useEffect(() => {
        setValueFromOutside = setValue
      }, [setValue])
      return (
        <KvCommandInput value={value} onValueChange={setValue} onRun={() => runs.push(value)} />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Redis command"]')!
      await act(async () => input.focus())
      await act(async () => setInputValue(input, 'H'))

      const list = document.body.querySelector<HTMLElement>(
        '[data-slot="autocomplete-list"][data-state="open"]',
      )!
      const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
      const initialActiveId = input.getAttribute('aria-activedescendant')

      expect(host.contains(list)).toBe(false)
      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-autocomplete')).toBe('list')
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(options).toHaveLength(5)
      expect(initialActiveId).not.toBeNull()
      expect(options[0]!.id).toBe(initialActiveId!)
      expect(options[0]?.getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(input)
      expect(host.querySelector('[data-slot="result-count-status"]')?.textContent).toBe(
        '5 commands',
      )

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id)
      expect(options[1]?.getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(input)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(input.value.endsWith(' ')).toBe(true)
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
      expect(runs).toHaveLength(0)
      expect(document.activeElement).toBe(input)

      await act(async () => setInputValue(input, 'PING'))
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(runs).toEqual(['PING'])

      await act(async () => setInputValue(input, 'S'))
      for (let index = 0; index < 4; index += 1) {
        await act(async () => {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        })
      }
      await act(async () => setValueFromOutside('HG'))

      const narrowedOptions = Array.from(
        document.body.querySelectorAll<HTMLElement>(
          '[data-slot="autocomplete-list"][data-state="open"] [role="option"]',
        ),
      )
      expect(narrowedOptions).toHaveLength(2)
      expect(input.getAttribute('aria-activedescendant')).toBe(narrowedOptions[1]!.id)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(input.getAttribute('aria-activedescendant')).toBe(narrowedOptions[0]!.id)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
