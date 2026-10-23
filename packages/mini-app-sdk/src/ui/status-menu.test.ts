import { describe, expect, test } from 'bun:test'

import { statusMenuList, STATUS_MENU_LIST_LIMIT } from './status-menu'
import type { MenuEntry } from './status-items'

const shape = (entries: readonly MenuEntry[]): string[] =>
  entries.map((entry) =>
    'separator' in entry ? '—' : 'header' in entry ? `#${entry.header}` : entry.label,
  )

const row = (name: string) => ({ id: `x:${name}`, label: name, onSelect: () => {} })

describe('statusMenuList', () => {
  test('an empty collection contributes NOTHING — not a title, not a rule', () => {
    // The dangling separator every mini app had: `[open, —, ...section]` with an empty section.
    expect(statusMenuList({ header: 'Open books', items: [], row })).toEqual([])
  })

  test('a short collection is its rows, under their title', () => {
    expect(shape(statusMenuList({ header: 'Open books', items: ['a', 'b'], row }))).toEqual([
      '#Open books',
      'a',
      'b',
    ])
  })

  test('a long collection says how much it is not showing', () => {
    const items = Array.from({ length: 11 }, (_, index) => `book-${index}`)
    const entries = statusMenuList({ items, row, onOverflow: () => {} })
    expect(entries).toHaveLength(STATUS_MENU_LIST_LIMIT + 1)
    expect(shape(entries)[entries.length - 1]).toBe('3 more in the workspace…')
  })

  test('the overflow row goes somewhere, or the list is not truncated at all', () => {
    // A truncation with nowhere to send the person is a dead end, and the fact they are looking
    // for is the one that got cut.
    const items = Array.from({ length: 11 }, (_, index) => `book-${index}`)
    expect(statusMenuList({ items, row })).toHaveLength(11)
  })

  test('the caller names the surface the overflow row opens', () => {
    const items = Array.from({ length: 10 }, (_, index) => `${index}`)
    const entries = statusMenuList({
      items,
      row,
      onOverflow: () => {},
      overflowLabel: (hidden) => `${hidden} more on the shelf…`,
    })
    expect(shape(entries)[entries.length - 1]).toBe('2 more on the shelf…')
  })

  test('exactly at the limit nothing is folded', () => {
    const items = Array.from({ length: STATUS_MENU_LIST_LIMIT }, (_, index) => `${index}`)
    expect(statusMenuList({ items, row, onOverflow: () => {} })).toHaveLength(
      STATUS_MENU_LIST_LIMIT,
    )
  })

  test('the overflow row runs what it was given', () => {
    let opened = 0
    const items = Array.from({ length: 9 }, (_, index) => `${index}`)
    const entries = statusMenuList({ items, row, onOverflow: () => (opened += 1) })
    const last = entries[entries.length - 1]!
    if ('separator' in last || 'header' in last || 'items' in last)
      throw new Error('expected a row')
    last.onSelect()
    expect(opened).toBe(1)
  })
})
