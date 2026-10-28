import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { FilterFacet } from './FilterMenu'
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

describe('FilterMenu — every narrowing behind one trigger', () => {
  test('a dimension is a submenu whose hint is its answer; a choice is a radio row', async () => {
    const { FilterMenu, filterFacetEntry, activeFacetCount } = await import('./FilterMenu')
    const changes: string[] = []
    const level: FilterFacet = {
      id: 'level',
      label: 'Level',
      value: 'error',
      allValue: 'all',
      options: [
        { value: 'all', label: 'All levels' },
        { value: 'error', label: 'Errors' },
      ],
      onChange: (value) => changes.push(`level:${value}`),
    }
    const time: FilterFacet = {
      id: 'time',
      label: 'Time',
      value: 'all',
      allValue: 'all',
      options: [
        { value: 'all', label: 'Any time' },
        { value: 'day', label: 'Past day' },
      ],
      onChange: (value) => changes.push(`time:${value}`),
    }

    // The model, without a DOM: the hint is the current answer, the rows are `selected` picks
    // that keep the menu open, and only a facet off its "all" value counts as active.
    const entry = filterFacetEntry(level)
    expect(entry.hint).toBe('Errors')
    expect(entry.items.map((row) => 'selected' in row && row.selected)).toEqual([false, true])
    expect(entry.items.every((row) => 'keepOpen' in row && row.keepOpen)).toBe(true)
    expect(activeFacetCount([level, time])).toBe(1)

    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<FilterMenu label="Filter events" facets={[level, time]} />))
    const trigger = host.querySelector<HTMLButtonElement>('button')!
    try {
      expect(trigger.getAttribute('aria-label')).toBe('Filter events: 1 active')
      expect(trigger.textContent).toContain('Filter · 1')
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
      const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      expect(rows.map((row) => row.textContent)).toEqual([
        'LevelErrors',
        'TimeAny time',
        'Clear filters',
      ])
      // Clearing resets only the facets that narrow, each to its own "all".
      await act(async () => {
        rows[2]!.click()
        await settle()
      })
      expect(changes).toEqual(['level:all'])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
