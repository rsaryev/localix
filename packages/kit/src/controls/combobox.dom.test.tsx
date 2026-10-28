import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '../testing/dom'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => turns()

describe('Combobox DOM runtime', () => {
  test('renders grouped searchable options in a portal and commits a selection', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { Combobox } = await import('./combobox')
    const onValueChange = mock((_value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [value, setValue] = useState('alpha')
      return (
        <Combobox
          aria-label="Runtime model"
          size="xl"
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
          options={[
            {
              value: 'alpha',
              label: 'Alpha',
              group: 'Provider A',
              description: '128k context',
            },
            { value: 'bravo', label: 'Bravo', group: 'Provider B', hint: 'current' },
          ]}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Runtime model"]')!
      expect(trigger.textContent).toContain('Alpha')
      expect(trigger.getAttribute('role')).toBeNull()
      expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')

      await act(async () => {
        trigger.click()
        await settle()
      })

      const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')!
      expect(content).not.toBeNull()
      expect(host.contains(content)).toBe(false)
      expect(content.textContent).toContain('Provider A')
      expect(content.textContent).toContain('Provider B')
      expect(content.textContent).toContain('128k context')
      const search = content.querySelector<HTMLInputElement>('[data-slot="command-input"]')!
      expect(search.getAttribute('role')).toBe('combobox')
      expect(content.querySelectorAll('[role="combobox"]')).toHaveLength(1)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(trigger.getAttribute('aria-controls')).toBe(content.id)

      const bravo = Array.from(
        content.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
      ).find((item) => item.textContent?.includes('Bravo'))
      expect(bravo).not.toBeUndefined()
      await act(async () => {
        bravo?.click()
        await settle()
      })

      expect(onValueChange).toHaveBeenCalledWith('bravo')
      expect(trigger.textContent).toContain('Bravo')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
