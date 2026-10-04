import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

describe('CommandDialog DOM runtime', () => {
  test('keeps focus in its named combobox while exposing and choosing the active result', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } =
      await import('./command')
    const onSelect = mock((_value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <CommandDialog open onOpenChange={() => undefined} title="Open resource">
            <Command>
              <CommandInput placeholder="Search resources…" />
              <CommandList>
                <CommandEmpty>No resources.</CommandEmpty>
                <CommandItem value="alpha" onSelect={onSelect}>
                  Alpha
                </CommandItem>
                <CommandItem value="bravo" onSelect={onSelect}>
                  Bravo
                </CommandItem>
              </CommandList>
            </Command>
          </CommandDialog>,
        )
        await settle()
      })

      const content = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]')!
      const command = content.querySelector<HTMLElement>('[data-slot="command"]')!
      const input = content.querySelector<HTMLInputElement>('[data-slot="command-input"]')!
      const list = content.querySelector<HTMLElement>('[data-slot="command-list"]')!
      const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
      const status = content.querySelector<HTMLElement>('[data-slot="command-result-status"]')!
      const label = document.getElementById(input.getAttribute('aria-labelledby') ?? '')

      expect(content.dataset.layout).toBe('edge-to-edge')
      expect(content.classList).toContain('overflow-hidden')
      expect(command.classList).toContain('overflow-hidden')
      expect(list.classList).toContain('overflow-y-auto')
      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(label?.textContent).toBe('Open resource')
      expect(list.getAttribute('role')).toBe('listbox')
      expect(status.parentElement).toBe(command)
      expect(list.contains(status)).toBe(false)
      expect(status.getAttribute('role')).toBe('status')
      expect(status.getAttribute('aria-live')).toBe('polite')
      expect(status.getAttribute('aria-atomic')).toBe('true')
      expect(status.textContent?.trim()).toBe('2 results')
      expect(document.activeElement).toBe(input)
      expect(options[0]?.getAttribute('aria-selected')).toBe('true')

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        await settle()
      })
      expect(options[1]?.getAttribute('aria-selected')).toBe('true')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id)
      expect(document.activeElement).toBe(input)

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(onSelect).toHaveBeenCalledWith('bravo')

      await act(async () => {
        setInputValue(input, 'alpha')
        await settle()
      })
      expect(status.textContent?.trim()).toBe('1 result')
      expect(list.querySelectorAll('[role="option"]')).toHaveLength(1)
      expect(document.activeElement).toBe(input)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
