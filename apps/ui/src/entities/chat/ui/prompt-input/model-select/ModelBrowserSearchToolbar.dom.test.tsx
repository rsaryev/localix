import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

async function renderToolbar(initialSearch = '') {
  const React = await import('react')
  const { act, useState } = React
  const { createRoot } = await import('react-dom/client')
  const { Command, CommandItem, CommandList } = await import('@localixai/kit/command')
  const { ModelBrowserSearchToolbar } = await import('./ModelBrowserSearchToolbar')
  const selected: string[] = []
  const changes: string[] = []
  const bubbled: string[] = []
  let armed = 0
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [search, setSearch] = useState(initialSearch)
    const results = ['alpha', 'bravo'].filter((name) => name.includes(search))
    return (
      <div onKeyDown={(event) => bubbled.push(event.key)}>
        <Command shouldFilter={false} label="Search models and providers">
          <div data-slot="model-browser-main-panel">
            <ModelBrowserSearchToolbar
              search={search}
              onSearchChange={(value) => {
                changes.push(value)
                setSearch(value)
              }}
              armKeyboardNav={() => armed++}
              disabled={disabled}
              trailing={<span data-slot="trailing-probe" />}
            />
            <CommandList>
              {results.map((value) => (
                <CommandItem key={value} value={value} onSelect={(picked) => selected.push(picked)}>
                  {value}
                </CommandItem>
              ))}
            </CommandList>
          </div>
        </Command>
      </div>
    )
  }

  await act(async () => {
    root.render(<Harness />)
    await settle()
  })
  return {
    host,
    selected,
    changes,
    bubbled,
    armed: () => armed,
    type: async (value: string) => {
      await act(async () => {
        const input = host.querySelector('input')!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        )
        input.dispatchEvent(new window.Event('input', { bubbles: true }))
        await settle()
      })
    },
    press: async (key: string, target: HTMLElement = host.querySelector('input')!) => {
      await act(async () => {
        target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
        await settle()
      })
    },
    clear: async () => {
      await act(async () => {
        const button = host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!
        button.dispatchEvent(
          new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        )
        button.click()
        await settle()
      })
    },
    disable: async (disabled: boolean) => {
      await act(async () => {
        root.render(<Harness disabled={disabled} />)
        await settle()
      })
    },
    cleanup: async () => {
      host.querySelector('input')?.blur()
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ModelBrowser model search band', () => {
  test('is one combobox with its trailing slot, above the results', async () => {
    const view = await renderToolbar()
    try {
      const input = view.host.querySelector<HTMLInputElement>('input')!
      expect(view.host.querySelectorAll('input')).toHaveLength(1)
      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('placeholder')).toBe('Search models…')
      const toolbar = view.host.querySelector('[data-slot="workbench-toolbar"]')!
      expect(toolbar.nextElementSibling?.getAttribute('role')).toBe('listbox')
      expect(toolbar.querySelector('[data-slot="trailing-probe"]')).not.toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('filters and clears without losing focus', async () => {
    const view = await renderToolbar()
    try {
      const input = view.host.querySelector<HTMLInputElement>('input')!
      input.focus()
      await view.type('brav')
      expect(view.changes).toEqual(['brav'])
      expect(view.host.querySelectorAll('[role="option"]')).toHaveLength(1)
      await view.clear()
      expect(input.value).toBe('')
      expect(view.host.querySelectorAll('[role="option"]')).toHaveLength(2)
      expect(document.activeElement).toBe(input)
      expect(view.selected).toEqual([])
    } finally {
      await view.cleanup()
    }
  })

  test('routes ArrowDown/Up and Enter to cmdk but not typing or the clear button', async () => {
    const view = await renderToolbar('a')
    try {
      await view.press('ArrowDown')
      expect(view.host.querySelector('[aria-selected="true"]')?.textContent).toBe('bravo')
      await view.press('ArrowUp')
      expect(view.host.querySelector('[aria-selected="true"]')?.textContent).toBe('alpha')
      expect(view.armed()).toBe(2)
      await view.press('Enter')
      expect(view.selected).toEqual(['alpha'])
      await view.press('x')
      expect(view.bubbled).not.toContain('x')
      const clear = view.host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!
      await view.press('Enter', clear)
      expect(view.selected).toEqual(['alpha'])
      await view.clear()
      expect(view.selected).toEqual(['alpha'])
    } finally {
      await view.cleanup()
    }
  })

  test('locks search with a disabled task and restores its query', async () => {
    const view = await renderToolbar('a')
    try {
      await view.disable(true)
      const toolbar = view.host.querySelector('[data-slot="workbench-toolbar"]')!
      expect(toolbar.hasAttribute('inert')).toBe(true)
      expect(toolbar.getAttribute('aria-disabled')).toBe('true')
      expect(view.host.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
      expect(
        view.host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.disabled,
      ).toBe(true)
      await view.disable(false)
      expect(toolbar.hasAttribute('inert')).toBe(false)
      expect(view.host.querySelector<HTMLInputElement>('input')!.disabled).toBe(false)
      expect(view.host.querySelector<HTMLInputElement>('input')!.value).toBe('a')
    } finally {
      await view.cleanup()
    }
  })
})
