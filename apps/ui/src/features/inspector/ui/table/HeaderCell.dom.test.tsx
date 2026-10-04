import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { TableColumn } from '@localixai/dataview'
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
const column: TableColumn = { id: 'customer', title: 'Customer', type: 'text' }

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

test('editable column names use the shared editor without NULL controls and Escape cancels', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { HeaderCell } = await import('./HeaderCell')
  const writes: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <HeaderCell
          col={{ ...column, sortable: false }}
          active={false}
          isPk={false}
          columnIndex={2}
          columnCount={2}
          showColumnIcons={false}
          onToggleSort={() => {}}
          onResizeStart={() => {}}
          onResizeKeyDown={() => {}}
          onResetWidth={() => {}}
          columnActions={{ rename: (_id, title) => writes.push(title) }}
        />,
      ),
    )
    const title = host.querySelector<HTMLButtonElement>('button[title^="Customer"]')!
    expect(title.disabled).toBe(false)
    await act(async () => {
      title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const input = host.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(input)
    expect(host.textContent).not.toContain('∅')
    await act(async () => setInputValue(input, 'Owner'))
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(writes).toEqual(['Owner'])
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[title^="Customer"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await act(async () => {
      host
        .querySelector<HTMLInputElement>('input')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(writes).toEqual(['Owner'])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

describe('HeaderCell column controls', () => {
  test('exposes sort state and submits a trimmed filter through the shared popover', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { HeaderCell } = await import('./HeaderCell')
    const onColumnFilter = mock((_columnId: string, _value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <HeaderCell
            col={column}
            active
            dir="desc"
            isPk={false}
            columnIndex={2}
            onToggleSort={() => {}}
            onColumnFilter={onColumnFilter}
            onResizeStart={() => {}}
            onResizeKeyDown={() => {}}
            onResetWidth={() => {}}
            columnWidth={248}
          />,
        ),
      )
      const header = host.querySelector<HTMLElement>('[role="columnheader"]')!
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Filter Customer column"]',
      )!
      expect(header.getAttribute('aria-colindex')).toBe('2')
      expect(header.getAttribute('aria-sort')).toBe('descending')
      const sash = host.querySelector<HTMLElement>('[data-slot="workbench-sash"]')!
      expect(sash.getAttribute('aria-valuenow')).toBe('248')
      expect(sash.getAttribute('aria-valuetext')).toBe('248 pixels')
      expect(sash.getAttribute('aria-description')).toContain('Use arrow keys to adjust')
      expect(sash.hasAttribute('title')).toBe(false)

      await act(async () => {
        trigger.click()
        await settle()
      })
      const content = document.body.querySelector<HTMLElement>(
        '[data-slot="popover-content"][aria-label="Filter Customer column"]',
      )!
      const input = content.querySelector<HTMLInputElement>('input[aria-label="Filter Customer"]')!
      expect(content).not.toBeNull()
      expect(document.activeElement).toBe(input)

      await act(async () => setInputValue(input, '  Alice  '))
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
      expect(onColumnFilter).toHaveBeenCalledWith('customer', 'Alice')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(content.getAttribute('data-state')).toBe('closed')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Filter Customer column')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('Escape dismisses without filtering and restores focus to the trigger', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { HeaderCell } = await import('./HeaderCell')
    const onColumnFilter = mock((_columnId: string, _value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <HeaderCell
            col={column}
            active={false}
            isPk
            columnIndex={3}
            onToggleSort={() => {}}
            onColumnFilter={onColumnFilter}
            onResizeStart={() => {}}
            onResizeKeyDown={() => {}}
            onResetWidth={() => {}}
          />,
        ),
      )
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Filter Customer column"]',
      )!
      expect(host.querySelector('[role="columnheader"]')?.getAttribute('aria-sort')).toBe('none')
      expect(
        host.querySelector('[data-slot="workbench-sash"]')?.getAttribute('aria-valuetext'),
      ).toBe('Automatic width')
      await act(async () => {
        trigger.click()
        await settle()
      })
      const input = document.body.querySelector<HTMLInputElement>(
        'input[aria-label="Filter Customer"]',
      )!
      await act(async () => setInputValue(input, 'uncommitted'))
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await settle()
      })
      expect(onColumnFilter).toHaveBeenCalledTimes(0)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      // Dismissed content unmounts, as it does in the app; nothing keeps a closed popover alive.
      expect(
        document.body.querySelector<HTMLElement>(
          '[data-slot="popover-content"][aria-label="Filter Customer column"]',
        ),
      ).toBeNull()
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Filter Customer column')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
