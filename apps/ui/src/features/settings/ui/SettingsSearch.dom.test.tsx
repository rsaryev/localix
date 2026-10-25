import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

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

describe('SettingsSearch combobox', () => {
  test('keeps input focus while arrows expose and Enter chooses the active result', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { settingsTargetUri } = await import('@/shared/lib/settingsAnchors')
    const { SettingsSearch } = await import('./SettingsSearch')
    const onNavigate = mock((_uri: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => root.render(<SettingsSearch onNavigate={onNavigate} />))
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
      await act(async () => input.focus())
      await act(async () => {
        setInputValue(input, 'save')
        await settle()
      })

      const list = document.body.querySelector<HTMLElement>(
        '[role="listbox"][aria-label="Settings search results"]',
      )!
      const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
      const status = document.body.querySelector<HTMLElement>('[data-slot="result-count-status"]')!
      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-autocomplete')).toBe('list')
      expect(input.getAttribute('aria-haspopup')).toBe('listbox')
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(list.dataset.slot).toBe('autocomplete-list')
      expect(host.contains(list)).toBe(false)
      expect(options).toHaveLength(4)
      expect(options[0]?.getAttribute('aria-selected')).toBe('true')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id)
      expect(status.textContent?.trim()).toBe('4 settings')
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
        await Promise.resolve()
      })
      expect(onNavigate).toHaveBeenCalledWith(
        settingsTargetUri({
          tab: 'editor',
          anchor: 'editor-on-save',
          entryId: 'editor.format-on-save',
        }),
      )
      expect(input.value).toBe('')
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
      expect(document.body.querySelector('[aria-label="Settings search results"]')).toBeNull()
      expect(document.activeElement).toBe(input)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('pointer selection does not steal focus and Escape clears the open query', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SettingsSearch } = await import('./SettingsSearch')
    const onNavigate = mock((_uri: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => root.render(<SettingsSearch onNavigate={onNavigate} />))
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
      await act(async () => input.focus())
      await act(async () => {
        // A query with at least two hits is what the pointer assertions below need;
        // they act on the SECOND option.
        setInputValue(input, 'model')
        await settle()
      })

      const options = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Settings search results"] [role="option"]',
        ),
      )
      expect(options.length).toBeGreaterThanOrEqual(2)
      await act(async () => {
        options[1]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(options[1]?.getAttribute('aria-selected')).toBe('true')

      await act(async () => {
        const mouseDownAccepted = options[1]?.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        )
        expect(mouseDownAccepted).toBe(false)
        options[1]?.click()
        await Promise.resolve()
      })
      expect(onNavigate).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(input)

      await act(async () => {
        setInputValue(input, 'provider')
        await settle()
      })
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(input.value).toBe('')
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(document.body.querySelector('[aria-label="Settings search results"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('outside interaction dismisses results without erasing the query', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SettingsSearch } = await import('./SettingsSearch')
    const host = document.createElement('div')
    const outside = document.createElement('button')
    outside.textContent = 'Outside control'
    document.body.append(host, outside)
    const root = createRoot(host)

    try {
      await act(async () => root.render(<SettingsSearch onNavigate={() => {}} />))
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
      await act(async () => input.focus())
      await act(async () => {
        setInputValue(input, 'save')
        await settle()
      })
      expect(document.body.querySelector('[aria-label="Settings search results"]')).not.toBeNull()

      await act(async () => {
        outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        outside.focus()
        await settle()
      })
      expect(input.value).toBe('save')
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(document.body.querySelector('[aria-label="Settings search results"]')).toBeNull()
      expect(document.activeElement).toBe(outside)

      await act(async () => {
        input.focus()
        await settle()
      })
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(document.body.querySelector('[aria-label="Settings search results"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      outside.remove()
    }
  })
})
