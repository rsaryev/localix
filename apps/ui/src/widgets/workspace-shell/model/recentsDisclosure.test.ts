import { describe, expect, test } from 'bun:test'
import { splitRecents } from './recentsDisclosure'
import type { RailEntry } from '../ui/shellTypes'

function entry(id: string, active = false): RailEntry {
  return { id, icon: null, label: id, active, onClick: () => {} }
}

describe('splitRecents', () => {
  // The rail spends one slot on recents, full stop: opening a view must not add an
  // icon to it, so even the ACTIVE entry stays behind the trigger.
  test('hover mode collapses everything, the active entry included', () => {
    const result = splitRecents([entry('a'), entry('b', true), entry('c')], 'hover')
    expect(result.visible).toEqual([])
    expect(result.collapsed.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  test('expanded mode leaves recency order untouched and hides nothing', () => {
    const result = splitRecents([entry('a'), entry('b', true)], 'expanded')
    expect(result.visible.map((e) => e.id)).toEqual(['a', 'b'])
    expect(result.collapsed).toEqual([])
  })

  test('off mode shows no slots at all — the active one included', () => {
    expect(splitRecents([entry('a', true)], 'off')).toEqual({ visible: [], collapsed: [] })
  })

  test('no recents means no trigger to render', () => {
    expect(splitRecents([], 'hover')).toEqual({ visible: [], collapsed: [] })
  })
})
