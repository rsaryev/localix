import { describe, expect, test } from 'bun:test'
import { emptySpace, type SpaceDocument } from '../format/document'
import { spaceTypes } from '../types'
import { applyOps } from './apply'
import type { SpaceOp } from './contract'
import { applyPatch } from './draft'
import { contentBounds, frameOf, membersOf } from './geometry'

/** A predictable id sequence, so ids in assertions are the ids the board made. */
function counter() {
  let n = 0
  return () => ((n++ % 24) + 0.5) / 32
}
const ctx = () => ({ registry: spaceTypes, random: counter() })
const run = (space: SpaceDocument, ops: SpaceOp[]) => applyOps(space, ops, ctx())

describe('operations', () => {
  test('a batch is pointwise: the bad operation is refused, the rest land, later ones see earlier ids', () => {
    const { space, results } = run(emptySpace(), [
      { op: 'create', type: 'note', id: 'idea', text: 'Login flow' },
      { op: 'create', type: 'hologram' },
      { op: 'create', type: 'shape', id: 'step', near: 'idea', text: 'Check token' },
      { op: 'connect', from: 'idea', to: 'step', label: 'then' },
    ])
    expect(results.map((result) => result.ok)).toEqual([true, false, true, true])
    expect((results[1] as { error: string }).error).toContain('the types are note, text')
    expect(space.elements.idea?.props.text).toBe('Login flow')
    expect(Object.values(space.edges)[0]).toMatchObject({ from: 'idea', to: 'step', label: 'then' })
  })

  test('an element without coordinates is placed where it overlaps nothing', () => {
    const { space } = run(emptySpace(), [
      { op: 'create', type: 'note', id: 'a', x: 0, y: 0 },
      { op: 'create', type: 'note', id: 'b', near: 'a' },
      { op: 'create', type: 'note', id: 'c', near: 'a' },
    ])
    const [a, b, c] = ['a', 'b', 'c'].map((id) => space.elements[id]!)
    expect(b!.x).toBeGreaterThanOrEqual(a!.x + a!.w)
    expect(c!.y).toBeGreaterThanOrEqual(a!.y + a!.h)
  })

  test('what a frame holds is where it is; moving the frame moves it, deleting keeps it', () => {
    const { space } = run(emptySpace(), [
      { op: 'create', type: 'frame', id: 'f', x: 0, y: 0, w: 600, h: 400 },
      { op: 'create', type: 'note', id: 'in', in: 'f' },
      { op: 'create', type: 'note', id: 'out', x: 900, y: 0 },
    ])
    expect(membersOf(space, 'f', spaceTypes)).toEqual(['in'])
    expect(frameOf(space, 'in', spaceTypes)).toBe('f')
    const moved = run(space, [{ op: 'update', id: 'f', x: 100, y: 50 }]).space
    expect(moved.elements.in!.x - space.elements.in!.x).toBe(100)
    expect(moved.elements.out!.x).toBe(900)
    expect(run(moved, [{ op: 'delete', id: 'f' }]).space.elements.in).toBeDefined()
  })

  test('props are validated against the type and merged; null returns a prop to its default', () => {
    const base = run(emptySpace(), [
      { op: 'create', type: 'note', id: 'n', props: { color: 'blue' } },
    ]).space
    const bad = run(base, [{ op: 'update', id: 'n', props: { color: 'teal' } }])
    expect(bad.results[0]?.ok).toBe(false)
    // Refused before any write: nothing to undo, nothing changed.
    expect(bad.patch).toEqual({ elements: {}, edges: {} })
    expect(bad.space.elements.n?.props.color).toBe('blue')
    const reset = run(base, [{ op: 'update', id: 'n', props: { color: null } }]).space
    expect(reset.elements.n?.props.color).toBe('yellow')
  })

  test('a locked element refuses changes until it is unlocked', () => {
    const base = run(emptySpace(), [{ op: 'create', type: 'note', id: 'n', locked: true }]).space
    expect(run(base, [{ op: 'delete', id: 'n' }]).results[0]?.ok).toBe(false)
    expect(run(base, [{ op: 'update', id: 'n', locked: false, x: 5 }]).space.elements.n?.x).toBe(5)
  })

  test('deleting an element takes its connectors with it', () => {
    const base = run(emptySpace(), [
      { op: 'create', type: 'note', id: 'a' },
      { op: 'create', type: 'note', id: 'b' },
      { op: 'connect', from: 'a', to: 'b', id: 'ab' },
    ]).space
    const { space, results } = run(base, [{ op: 'delete', id: 'a' }])
    expect(space.edges.ab).toBeUndefined()
    expect(results[0]).toEqual({ ok: true, id: 'a', note: 'with 1 connector' })
  })
})

describe('history patches', () => {
  test('undo restores the befores, redo the afters, and a newer change is never overwritten', () => {
    const base = run(emptySpace(), [{ op: 'create', type: 'note', id: 'n', text: 'one' }]).space
    const edit = run(base, [
      { op: 'update', id: 'n', text: 'two' },
      { op: 'update', id: 'n', text: 'three' },
    ])
    // Two updates of one record are one patch entry: from the first value to the last.
    expect(edit.patch.elements.n?.[0]?.props.text).toBe('one')
    expect(edit.patch.elements.n?.[1]?.props.text).toBe('three')
    const undone = applyPatch(edit.space, edit.patch, 0)
    expect(undone.space.elements.n?.props.text).toBe('one')
    expect(applyPatch(undone.space, edit.patch, 1).space.elements.n?.props.text).toBe('three')

    const agent = run(edit.space, [{ op: 'update', id: 'n', text: 'agent' }]).space
    const blocked = applyPatch(agent, edit.patch, 0)
    expect(blocked.conflicts).toEqual(['n'])
    expect(blocked.space.elements.n?.props.text).toBe('agent')
  })
})

describe('content bounds', () => {
  test('an empty board has none; otherwise the box spans every element', () => {
    expect(contentBounds(emptySpace())).toBeNull()
    const { space } = run(emptySpace(), [
      { op: 'create', type: 'note', id: 'a', x: -40, y: 10, w: 100, h: 50 },
      { op: 'create', type: 'note', id: 'b', x: 200, y: -30, w: 60, h: 20 },
    ])
    const { a, b } = space.elements as Record<
      'a' | 'b',
      { x: number; y: number; w: number; h: number }
    >
    expect(contentBounds(space)).toEqual({
      x: -40,
      y: -30,
      w: Math.max(a.x + a.w, b.x + b.w) + 40,
      h: Math.max(a.y + a.h, b.y + b.h) + 30,
    })
  })
})
