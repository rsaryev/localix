import { describe, expect, test } from 'bun:test'
import { computeDropIndex, moveItem } from './dropIndex'

describe('where a dragged row lands', () => {
  const list = ['a', 'b', 'c', 'd']

  test('before the target when the pointer is above its midpoint', () => {
    expect(computeDropIndex(list, 'd', 'b', false)).toBe(1)
  })

  test('after the target when the pointer is below it', () => {
    expect(computeDropIndex(list, 'd', 'b', true)).toBe(2)
  })

  /**
   * The off-by-one this function exists for. Dragging DOWNWARD, the dragged row is still in
   * the list ahead of the target, so an index taken against the original list is one too
   * high — and the row lands one place past the caret the user was aiming at.
   */
  test('dragging downward lands where the caret said', () => {
    expect(computeDropIndex(list, 'a', 'c', true)).toBe(2)
    expect(moveItem(list, 0, computeDropIndex(list, 'a', 'c', true))).toEqual(['b', 'c', 'a', 'd'])
  })

  test('a target that is gone appends', () => {
    expect(computeDropIndex(list, 'a', 'missing', false)).toBe(3)
  })

  /**
   * A row dropped on ITSELF is not this function's problem: with the dragged id removed the
   * target no longer exists, so it answers "append", the same as any unknown target. Callers
   * guard the gesture instead — a drag that never arms a drop on its own row cannot get here.
   */
  test('a row dropped on itself reads as an unknown target', () => {
    expect(computeDropIndex(list, 'b', 'b', false)).toBe(3)
  })
})

describe('moving an item', () => {
  test('never mutates its input', () => {
    const list = ['a', 'b', 'c']
    const moved = moveItem(list, 0, 2)

    expect(list).toEqual(['a', 'b', 'c'])
    expect(moved).toEqual(['b', 'c', 'a'])
  })

  test('clamps an index past the end and ignores one out of range', () => {
    expect(moveItem(['a', 'b'], 0, 99)).toEqual(['b', 'a'])
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})
