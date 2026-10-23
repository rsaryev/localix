import { describe, expect, test } from 'bun:test'
import { emptySpace, type SpaceDocument } from '../format/document'
import { byOrder } from '../format/order'
import { parseSpace } from '../format/parse'
import { serializeSpace } from '../format/serialize'
import { spaceTypes } from '../types'
import { applyOps } from './apply'
import type { SpaceOp } from './contract'
import { selectionGroup } from './groups'

function counter() {
  let n = 0
  return () => ((n++ % 24) + 0.5) / 32
}
const run = (space: SpaceDocument, ops: SpaceOp[]) =>
  applyOps(space, ops, { registry: spaceTypes, random: counter() })
const stack = (space: SpaceDocument) =>
  Object.entries(space.elements)
    .map(([id, element]) => ({ id, ...element }))
    .sort(byOrder)
    .map((element) => element.id)

/** Three overlapping notes a, b, c (bottom to top) and a far one d on top of them all. */
function pile() {
  return run(emptySpace(), [
    { op: 'create', type: 'note', id: 'a', x: 0, y: 0 },
    { op: 'create', type: 'note', id: 'b', x: 50, y: 50 },
    { op: 'create', type: 'note', id: 'c', x: 100, y: 100 },
    { op: 'create', type: 'note', id: 'd', x: 2000, y: 0 },
  ]).space
}

describe('stacking', () => {
  test('forward steps past the next element that OVERLAPS, not the next in the list', () => {
    const { space } = run(pile(), [{ op: 'order', ids: ['a'], to: 'forward' }])
    expect(stack(space)).toEqual(['b', 'a', 'c', 'd'])
  })

  test('a set keeps its own order going to the front or the back', () => {
    const front = run(pile(), [{ op: 'order', ids: ['b', 'a'], to: 'front' }]).space
    expect(stack(front)).toEqual(['c', 'd', 'a', 'b'])
    const back = run(pile(), [{ op: 'order', ids: ['d', 'c'], to: 'back' }]).space
    expect(stack(back)).toEqual(['c', 'd', 'a', 'b'])
  })

  test('nothing overlapping above means forward is a no-op that says so', () => {
    const { space, results } = run(pile(), [{ op: 'order', ids: ['d'], to: 'forward' }])
    expect(stack(space)).toEqual(['a', 'b', 'c', 'd'])
    expect(results[0]).toMatchObject({ ok: true, note: 'unchanged: nothing above overlaps it' })
  })
})

describe('groups', () => {
  test('grouping nests: the new id is appended outermost, and a group id targets its members', () => {
    const { space, results } = run(pile(), [
      { op: 'group', ids: ['a', 'b'], id: 'inner' },
      { op: 'group', ids: ['inner', 'c'], id: 'outer' },
      { op: 'order', ids: ['outer'], to: 'back' },
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(space.elements.a?.groups).toEqual(['inner', 'outer'])
    expect(space.elements.c?.groups).toEqual(['outer'])
    expect(stack(space)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('a click selects the outermost group, then drills one level in at a time', () => {
    const { space } = run(pile(), [
      { op: 'group', ids: ['a', 'b'], id: 'inner' },
      { op: 'group', ids: ['inner', 'c'], id: 'outer' },
    ])
    expect(selectionGroup(space, 'a')).toBe('outer')
    expect(selectionGroup(space, 'a', 'outer')).toBe('inner')
    expect(selectionGroup(space, 'a', 'inner')).toBeNull()
    expect(selectionGroup(space, 'd')).toBeNull()
  })

  test('ungroup removes only that level; a group deleted down to one member is no group', () => {
    const grouped = run(pile(), [
      { op: 'group', ids: ['a', 'b'], id: 'inner' },
      { op: 'group', ids: ['inner', 'c'], id: 'outer' },
    ]).space
    const { space } = run(grouped, [{ op: 'ungroup', id: 'outer' }])
    expect(space.elements.a?.groups).toEqual(['inner'])
    expect(space.elements.c?.groups).toBeUndefined()
    const lone = run(grouped, [
      { op: 'delete', id: 'b' },
      { op: 'ungroup', id: 'inner' },
    ])
    expect(lone.results[1]).toMatchObject({ ok: false })
    expect(selectionGroup(lone.space, 'a')).toBe('outer')
  })

  test('grouping gathers the members into one run at the topmost, a bystander below them', () => {
    const { space } = run(pile(), [{ op: 'group', ids: ['a', 'c'], id: 'ends' }])
    expect(stack(space)).toEqual(['b', 'a', 'c', 'd'])
    // Already one run: no key is rewritten.
    const before = pile()
    const { patch } = run(before, [{ op: 'group', ids: ['b', 'c'] }])
    expect(Object.values(patch.elements).every(([was, now]) => was?.z === now?.z)).toBe(true)
  })

  test('a group id that is taken, or a group of one, is refused', () => {
    const { results } = run(pile(), [
      { op: 'group', ids: ['a', 'b'], id: 'c' },
      { op: 'group', ids: ['a'] },
    ])
    expect(results.map((result) => result.ok)).toEqual([false, false])
  })
})

describe('align, distribute, arrange', () => {
  test('align moves whole groups as units, so a group keeps its inside', () => {
    const { space } = run(pile(), [
      { op: 'group', ids: ['a', 'b'], id: 'pair' },
      { op: 'align', ids: ['pair', 'd'], edge: 'top' },
    ])
    expect([space.elements.a?.y, space.elements.b?.y, space.elements.d?.y]).toEqual([0, 50, 0])
    const right = run(pile(), [{ op: 'align', ids: ['a', 'd'], edge: 'right' }]).space
    expect(right.elements.a?.x).toBe(2000)
  })

  test('targets that are one whole group are laid out inside it, not refused as one unit', () => {
    // The agent grouped a three-note legend, then aligned the three by id.
    const { space, results } = run(pile(), [
      { op: 'group', ids: ['a', 'b', 'c'], id: 'legend' },
      { op: 'align', ids: ['a', 'b', 'c'], edge: 'top' },
      { op: 'arrange', ids: ['legend'], layout: 'row', gap: 10 },
    ])
    expect(results.map((result) => result.ok)).toEqual([true, true, true])
    expect(['a', 'b', 'c'].map((id) => space.elements[id]?.y)).toEqual([0, 0, 0])
    expect(['a', 'b', 'c'].map((id) => space.elements[id]?.x)).toEqual([0, 210, 420])
  })

  test('distribute leaves equal gaps and keeps the outer two in place', () => {
    const space = run(emptySpace(), [
      { op: 'create', type: 'note', id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { op: 'create', type: 'note', id: 'b', x: 150, y: 0, w: 100, h: 100 },
      { op: 'create', type: 'note', id: 'c', x: 600, y: 0, w: 100, h: 100 },
      { op: 'distribute', ids: ['a', 'b', 'c'], axis: 'horizontal' },
    ]).space
    expect(['a', 'b', 'c'].map((id) => space.elements[id]?.x)).toEqual([0, 300, 600])
  })

  test('arrange in a frame lays out what it holds in reading order and fits the frame', () => {
    const { space, results } = run(emptySpace(), [
      { op: 'create', type: 'frame', id: 'f', x: 0, y: 0, w: 2000, h: 2000, text: 'Area' },
      { op: 'create', type: 'note', id: 'n2', x: 900, y: 100, w: 100, h: 100 },
      { op: 'create', type: 'note', id: 'n1', x: 100, y: 110, w: 100, h: 100 },
      { op: 'create', type: 'note', id: 'n3', x: 400, y: 800, w: 100, h: 100 },
      { op: 'arrange', in: 'f', layout: 'row', gap: 20 },
    ])
    expect(results.at(-1)).toMatchObject({ ok: true })
    expect(['n1', 'n2', 'n3'].map((id) => space.elements[id]?.x)).toEqual([24, 144, 264])
    expect(space.elements.n3?.y).toBe(48)
    expect(space.elements.f).toMatchObject({ w: 364 + 24 - 0, h: 148 + 24 })
  })

  test('a locked element stays put and the result says so', () => {
    const { space, results } = run(pile(), [
      { op: 'update', id: 'b', locked: true },
      { op: 'align', ids: ['a', 'b', 'c'], edge: 'left' },
    ])
    expect(space.elements.b?.x).toBe(50)
    expect(space.elements.c?.x).toBe(0)
    expect((results[1] as { note: string }).note).toContain('1 locked stayed put')
  })
})

describe('the envelope', () => {
  test('opacity and groups survive a write and a read; defaults write nothing', () => {
    const { space } = run(pile(), [
      { op: 'update', id: 'a', opacity: 0.4 },
      { op: 'update', id: 'b', opacity: 1 },
      { op: 'group', ids: ['a', 'b'], id: 'pair' },
    ])
    const text = serializeSpace(space)
    const back = parseSpace(text, spaceTypes).space
    expect(back.elements.a).toMatchObject({ opacity: 0.4, groups: ['pair'] })
    expect('opacity' in (back.elements.b ?? {})).toBe(false)
    expect('groups' in (back.elements.c ?? {})).toBe(false)
  })
})
