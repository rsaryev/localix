import { describe, expect, test } from 'bun:test'
import type { SpaceView } from '../shared/api'
import { emptySpace } from '../shared/format/document'
import { applyOps } from '../shared/ops/apply'
import { spaceTypes } from '../shared/types'
import { flowCache, toFlow } from './board/toFlow'
import { LOCAL_REVISION, settle } from './settle'

/** A board as the server answers it: parsed afresh, so every object is new. */
function answer(revision: string, ops: Parameters<typeof applyOps>[1]): SpaceView {
  const space = applyOps(emptySpace(), ops, { registry: spaceTypes }).space
  return structuredClone({
    space,
    issues: [],
    writable: true,
    revision,
    canUndo: false,
    canRedo: false,
    missing: [],
    stamps: {},
  })
}

const board = [
  { op: 'create' as const, type: 'note', id: 'a', x: 0, y: 0, text: 'one' },
  { op: 'create' as const, type: 'note', id: 'b', x: 300, y: 0, text: 'two' },
]

describe('taking in a poll', () => {
  test('an answer that says the same thing keeps the view — and every node — as it is', () => {
    const first = answer('r1', board)
    const cache = flowCache()
    const before = toFlow(first, spaceTypes, cache).nodes
    const kept = settle(first, answer('r1', board))
    expect(kept).toBe(first)
    const after = toFlow(kept, spaceTypes, cache).nodes
    expect(after.every((node, index) => node === before[index])).toBe(true)
  })

  test('a change to one element redraws that one: the others keep their nodes', () => {
    const first = answer('r1', board)
    const cache = flowCache()
    const before = new Map(toFlow(first, spaceTypes, cache).nodes.map((node) => [node.id, node]))
    const changed = settle(first, answer('r2', [board[0]!, { ...board[1]!, text: 'two, edited' }]))
    const after = new Map(toFlow(changed, spaceTypes, cache).nodes.map((node) => [node.id, node]))
    expect(after.get('a')).toBe(before.get('a'))
    expect(after.get('b')).not.toBe(before.get('b'))
  })

  test("a local guess is always replaced by the server's answer, even at the same revision", () => {
    // A refused change: the answer is the file as it was, under the revision it had.
    const server = answer('r1', board)
    const guess = { ...answer('r1', [board[0]!]), revision: LOCAL_REVISION }
    expect(settle(guess, server).space.elements.b).toBeDefined()
  })
})
