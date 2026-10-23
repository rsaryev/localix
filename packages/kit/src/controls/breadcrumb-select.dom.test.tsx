import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import type { BreadcrumbSelectItem } from './breadcrumb-select'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('BreadcrumbSelect interactions', () => {
  test('opens the sibling picker, filters long lists, and selects a sibling', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { BreadcrumbSelect } = await import('./breadcrumb-select')
    const selected: string[] = []
    const openStates: boolean[] = []
    const items: BreadcrumbSelectItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `book-${index + 1}`,
      label: `Book ${index + 1}`,
      description: index === 7 ? 'Octavia Butler · EPUB' : `Author ${index + 1} · EPUB`,
      active: index === 2,
      onSelect: () => selected.push(`book-${index + 1}`),
    }))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <BreadcrumbSelect
            label="Book 3"
            items={items}
            ariaLabel="Switch book"
            searchPlaceholder="Search books"
            onOpenChange={(open) => openStates.push(open)}
          />,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Switch book"]')!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
        )
        trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(openStates).toEqual([true])
      const list = document.body.querySelector('[data-slot="breadcrumb-select-list"]')!
      expect(list.querySelector('input')).toBeNull()
      expect(
        document.body.querySelector('[role="menuitem"][aria-current="page"]')?.textContent,
      ).toContain('Book 3')

      const search = document.body.querySelector<HTMLInputElement>(
        'input[aria-label="Search books"]',
      )!
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Search books')
      act(() => {
        search.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      expect(selected).toEqual([])
      expect(trigger.getAttribute('aria-expanded')).toBe('true')

      const changeSearch = async (value: string) =>
        act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            search,
            value,
          )
          search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
          await new Promise((resolve) => setTimeout(resolve, 0))
        })

      await changeSearch('Missing title')
      expect(document.body.querySelector('[role="status"]')?.textContent).toContain('0 results')
      expect(document.body.textContent).toContain('No matches')
      act(() => {
        search.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      expect(selected).toEqual([])
      expect(trigger.getAttribute('aria-expanded')).toBe('true')

      await changeSearch('Octavia')

      const visibleItems = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      )
      expect(visibleItems).toHaveLength(1)
      expect(visibleItems[0]?.textContent).toContain('Book 8')

      act(() => {
        search.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
      expect(document.activeElement?.textContent).toContain('Book 8')

      await act(async () => {
        search.focus()
        search.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(selected).toEqual(['book-8'])
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(openStates).toEqual([true, false])
      // Focus restoration on close is ASYNCHRONOUS (the menu returns it to the trigger
      // after its own teardown), so give it a turn before asserting. Reading it in the
      // same tick happened to pass alone and failed whenever another suite ran first —
      // an ordering artefact of the test, not of the component.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Switch book')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
