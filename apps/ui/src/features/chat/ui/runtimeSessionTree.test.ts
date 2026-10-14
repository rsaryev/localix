import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { buildRuntimeSessionTree } from './runtimeSessionTree'

const session = (id: string, parentSessionId: string, createdAt: number) =>
  ({ id, parentSessionId, createdAt }) as UiSession

const sessions = [
  session('older', 'main', 1),
  session('newer', 'main', 2),
  session('child', 'newer', 3),
  session('grandchild', 'child', 4),
  session('sibling', 'newer', 5),
]

describe('runtime session branches', () => {
  test('orders parents before descendants and keeps siblings newest first', () => {
    const nodes = buildRuntimeSessionTree(sessions)
    expect(nodes.map((node) => [node.session.id, node.depth, node.childCount])).toEqual([
      ['newer', 0, 2],
      ['sibling', 1, 0],
      ['child', 1, 1],
      ['grandchild', 2, 0],
      ['older', 0, 0],
    ])
    expect(nodes[1]?.isLast).toBe(false)
    expect(nodes[2]?.isLast).toBe(true)
    expect(nodes[3]?.prefixCols).toEqual([false])
  })

  test('folds all descendants of a branch without hiding its siblings or parent', () => {
    const nodes = buildRuntimeSessionTree(sessions, new Set(['newer']))
    expect(nodes.map((node) => node.session.id)).toEqual(['newer', 'older'])
    expect(nodes[0]?.childCount).toBe(2)
    expect(sessions).toHaveLength(5)
  })

  test('retains a nested fold while its parent is folded and expanded again', () => {
    expect(
      buildRuntimeSessionTree(sessions, new Set(['newer', 'child'])).map((node) => node.session.id),
    ).toEqual(['newer', 'older'])
    expect(
      buildRuntimeSessionTree(sessions, new Set(['child'])).map((node) => node.session.id),
    ).toEqual(['newer', 'sibling', 'child', 'older'])
  })
})
