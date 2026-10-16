import { describe, expect, test } from 'bun:test'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'

import { menuLevelNeedsGutter, normalizeMenuEntries } from './menu-model'

const act = (id: string, extra: Partial<MenuEntry> = {}): MenuEntry =>
  ({ id, label: id, onSelect: () => {}, ...extra }) as MenuEntry
const rule = { separator: true } as const

const shape = (entries: readonly MenuEntry[]): string[] =>
  entries.map((entry) =>
    'separator' in entry ? '—' : 'header' in entry ? `#${entry.header}` : entry.id,
  )

describe('normalizeMenuEntries', () => {
  test('keeps a menu that already reads correctly', () => {
    const menu = [act('open'), rule, act('a'), act('b'), rule, act('settings')]
    expect(shape(normalizeMenuEntries(menu))).toEqual(['open', '—', 'a', 'b', '—', 'settings'])
  })

  test('drops the rule an empty spread leaves at the top', () => {
    expect(shape(normalizeMenuEntries([rule, act('a')]))).toEqual(['a'])
  })

  test('drops the rule the host appends under an item that declared no menu', () => {
    expect(shape(normalizeMenuEntries([act('a'), rule]))).toEqual(['a'])
  })

  test('collapses the double rule two empty spreads meet at', () => {
    // `[open, —, ...rows, —, ...actions]` with no rows and no actions is the exact shape the
    // Office and Reader menus produce for a session with nothing running.
    expect(shape(normalizeMenuEntries([act('open'), rule, rule, act('settings')]))).toEqual([
      'open',
      '—',
      'settings',
    ])
  })

  test('a header keeps its group and loses the rule between them', () => {
    const menu = [act('open'), rule, { header: 'Running' }, rule, act('worker')]
    expect(shape(normalizeMenuEntries(menu))).toEqual(['open', '—', '#Running', 'worker'])
  })

  test('a header with nothing under it is dropped', () => {
    expect(shape(normalizeMenuEntries([act('open'), rule, { header: 'Running' }]))).toEqual([
      'open',
    ])
    expect(
      shape(normalizeMenuEntries([{ header: 'Running' }, { header: 'Waiting' }, act('w')])),
    ).toEqual(['#Waiting', 'w'])
  })

  test('an all-seam menu collapses to nothing rather than to a stack of rules', () => {
    expect(normalizeMenuEntries([rule, rule, { header: 'Nothing' }, rule])).toEqual([])
  })

  test('normalises inside a submenu, and sees the level it empties', () => {
    const menu: MenuEntry[] = [
      act('open'),
      rule,
      { id: 'group', label: 'Group', items: [rule, act('inner'), rule] },
    ]
    const out = normalizeMenuEntries(menu)
    expect(shape(out)).toEqual(['open', '—', 'group'])
    const submenu = out[2]!
    expect('items' in submenu && shape(submenu.items)).toEqual(['inner'])
  })

  test('does not mutate the menu it was given', () => {
    const menu: MenuEntry[] = [rule, act('a'), rule]
    normalizeMenuEntries(menu)
    expect(menu).toHaveLength(3)
  })
})

describe('menuLevelNeedsGutter', () => {
  test('a level of plain actions aligns on the text edge', () => {
    expect(menuLevelNeedsGutter([act('a'), act('b')])).toBe(false)
  })

  test('a check never claims the leading column — it sits at the end of the row', () => {
    expect(menuLevelNeedsGutter([act('a'), act('b', { checked: false })])).toBe(false)
    expect(menuLevelNeedsGutter([act('a', { selected: true }), act('b', { checked: true })])).toBe(
      false,
    )
  })

  test('one icon indents the whole level', () => {
    const Icon = () => null
    expect(menuLevelNeedsGutter([act('a'), act('b', { checked: false, icon: Icon })])).toBe(true)
  })

  test('an icon on an action or a submenu reserves the column', () => {
    const Icon = () => null
    expect(menuLevelNeedsGutter([act('a', { icon: Icon })])).toBe(true)
    expect(menuLevelNeedsGutter([{ id: 's', label: 'S', icon: Icon, items: [] }])).toBe(true)
  })

  test('rules and headers decide nothing', () => {
    expect(menuLevelNeedsGutter([rule, { header: 'Group' }])).toBe(false)
  })
})
