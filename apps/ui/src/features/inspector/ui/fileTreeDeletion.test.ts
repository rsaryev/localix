import { describe, expect, test } from 'bun:test'
import { describeDeletion } from './fileTreeDeletion'

describe('describeDeletion', () => {
  test('returns nothing without targets', () => {
    expect(describeDeletion([], false)).toEqual({})
  })

  test('describes a single file moved to Trash', () => {
    expect(describeDeletion([{ path: '/p/a.ts', name: 'a.ts', type: 'file' }], false)).toEqual({
      title: 'Delete file?',
      description: '“a.ts” will be moved to Trash. It will move to Trash — you can undo this.',
    })
  })

  test('describes a permanent folder delete', () => {
    const copy = describeDeletion([{ path: '/p/src', name: 'src', type: 'dir' }], true)
    expect(copy.title).toBe('Delete folder permanently?')
    expect(copy.description).toBe(
      '“src” and its contents will be permanently deleted. This cannot be undone.',
    )
  })

  test('counts multiple targets and notes folder contents', () => {
    const copy = describeDeletion(
      [
        { path: '/p/a', name: 'a', type: 'file' },
        { path: '/p/b', name: 'b', type: 'dir' },
      ],
      false,
    )
    expect(copy.title).toBe('Delete 2 items?')
    expect(copy.description).toContain('2 items (including folder contents) will be moved to Trash')
    expect(
      describeDeletion(
        [
          { path: '/p/a', name: 'a', type: 'file' },
          { path: '/p/c', name: 'c', type: 'file' },
        ],
        true,
      ).title,
    ).toBe('Delete 2 items permanently?')
  })
})
