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
    const { FilterMenu } = await import('./FilterMenu')
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
      // The submenu's rows are radio picks with the current answer checked; a pick steps back out
      // to the menu, which stays open.
      await act(async () => {
        rows[0]!.focus()
        rows[0]!.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        )
        await settle()
      })
      const picks = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      expect(picks().map((row) => [row.textContent, row.getAttribute('aria-checked')])).toEqual([
        ['All levels', 'false'],
        ['Errors', 'true'],
      ])
      await act(async () => {
        picks()[0]!.click()
        await settle()
      })
      expect(changes).toEqual(['level:all'])
      expect(picks()).toHaveLength(0)
      expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(3)
      changes.length = 0
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
