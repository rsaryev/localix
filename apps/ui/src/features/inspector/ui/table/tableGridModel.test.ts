import { describe, expect, test } from 'bun:test'
import { cellTitle, deleteActionTitle, justify } from './tableGridModel'

describe('table grid model', () => {
  test('maps column alignment to flex justification', () => {
    expect(justify('right')).toBe('flex-end')
    expect(justify('center')).toBe('center')
    expect(justify('left')).toBe('flex-start')
  })

  test('titles the delete toggle by staged state', () => {
    expect(deleteActionTitle(true, false)).toBe('Undo delete')
    expect(deleteActionTitle(true, true)).toBe('Undo delete')
    expect(deleteActionTitle(false, true)).toBe('Mark row for deletion')
    expect(deleteActionTitle(false, false)).toBe('Delete row')
  })

  test('titles cells by edit capability', () => {
    expect(cellTitle(true, true)).toBe('Double-click to edit')
    expect(cellTitle(false, true)).toBe('This result column is not a direct table column')
    expect(cellTitle(false, false)).toBeUndefined()
  })
})
