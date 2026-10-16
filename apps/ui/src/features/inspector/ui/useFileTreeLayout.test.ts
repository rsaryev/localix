import { describe, expect, test } from 'bun:test'
import type { FileTreeRow } from './fileTreeRows'
import { isRootEmptyLayout, layoutIndexes } from './useFileTreeLayout'

const status = (depth: number, s: 'empty' | 'loading' = 'empty'): FileTreeRow => ({
  kind: 'status',
  key: `status:${s}:${depth}`,
  depth,
  parentPath: '/p',
  status: s,
})

describe('file tree layout helpers', () => {
  test('detects only a lone root-level empty status', () => {
    expect(isRootEmptyLayout([status(0)])).toBe(true)
    expect(isRootEmptyLayout([status(1)])).toBe(false)
    expect(isRootEmptyLayout([status(0, 'loading')])).toBe(false)
    expect(isRootEmptyLayout([])).toBe(false)
  })

  test('indexes entry rows by path, skipping non-entry rows', () => {
    const rows = [
      status(1, 'loading'),
      { kind: 'entry', key: 'a', path: '/p/a', name: 'a', type: 'file', depth: 0 },
    ] as unknown as FileTreeRow[]
    expect([...layoutIndexes(rows)]).toEqual([['/p/a', 1]])
  })
})
