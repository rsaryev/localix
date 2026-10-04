import { describe, expect, test } from 'bun:test'
import {
  computeDropZone,
  resolveDropAction,
  insertIndexForX,
  bodyOwnsMessageBindingDrops,
} from './dropZone'

// A 1000x1000 group at the origin → fractions map 1:1 to pixels/1000.
const rect = {
  left: 0,
  top: 0,
  width: 1000,
  height: 1000,
  right: 1000,
  bottom: 1000,
  x: 0,
  y: 0,
  toJSON() {},
} as DOMRect
const at = (x: number, y: number, prev?: 'center' | 'left' | 'right' | 'up' | 'down' | null) =>
  computeDropZone(rect, x, y, prev)

describe('computeDropZone', () => {
  test('center when far from every edge', () => {
    expect(at(500, 500)).toBe('center')
  })

  test('picks the nearest edge within the enter band', () => {
    expect(at(100, 500)).toBe('left') // 10% from left
    expect(at(900, 500)).toBe('right')
    expect(at(500, 100)).toBe('up')
    expect(at(500, 900)).toBe('down')
  })

  test('just inside vs just outside the enter threshold', () => {
    expect(at(240, 500)).toBe('left') // 0.24 < 0.25
    expect(at(260, 500)).toBe('center') // 0.26 > 0.25, no prev
  })

  test('hysteresis: a held edge stays sticky through the wider exit band', () => {
    // At 0.28 with no prior zone → center; but if we were already showing 'left'
    // it holds until past the 0.32 exit band.
    expect(at(280, 500, null)).toBe('center')
    expect(at(280, 500, 'left')).toBe('left') // sticky
    expect(at(330, 500, 'left')).toBe('center') // 0.33 > exit → release
  })

  test('hysteresis does not stick a DIFFERENT edge', () => {
    // Showing 'left' but cursor is near the right edge → switch, no sticky hold.
    expect(at(900, 500, 'left')).toBe('right')
  })
})

describe('resolveDropAction', () => {
  test('center always moves the tab into the target group', () => {
    expect(resolveDropAction('center', 'gB', 'gA', 3)).toEqual({ type: 'move', toGroup: 'gB' })
    // A center self-drop is still a move (lands the tab at the end — old behavior).
    expect(resolveDropAction('center', 'gA', 'gA', 1)).toEqual({ type: 'move', toGroup: 'gA' })
  })

  test('an edge drop carves a new group', () => {
    expect(resolveDropAction('right', 'gB', 'gA', 1)).toEqual({ type: 'split', dir: 'right' })
    // Same group but more than one tab → a real split-off of this tab is meaningful.
    expect(resolveDropAction('down', 'gA', 'gA', 2)).toEqual({ type: 'split', dir: 'down' })
  })

  test('edge-dropping a group’s SOLE tab onto itself is a no-op (no split-then-collapse churn)', () => {
    expect(resolveDropAction('right', 'gA', 'gA', 1)).toEqual({ type: 'none' })
    expect(resolveDropAction('up', 'gA', 'gA', 0)).toEqual({ type: 'none' }) // defensive
  })
})

describe('insertIndexForX (foreign strip-drop lands where the cursor is)', () => {
  // Three 100px tabs at x=[0,100,200] → midpoints 50, 150, 250.
  const mids = [50, 150, 250]
  test('before the first tab → index 0', () => {
    expect(insertIndexForX(mids, 10)).toBe(0)
    expect(insertIndexForX(mids, 49)).toBe(0)
  })
  test('between tabs → the slot after the tab whose midpoint is passed', () => {
    expect(insertIndexForX(mids, 60)).toBe(1) // past tab 0's midpoint
    expect(insertIndexForX(mids, 160)).toBe(2) // past tab 1's midpoint
  })
  test('past the last midpoint → append at the end', () => {
    expect(insertIndexForX(mids, 260)).toBe(3)
    expect(insertIndexForX(mids, 9999)).toBe(3)
  })
  test('empty strip → index 0', () => {
    expect(insertIndexForX([], 100)).toBe(0)
  })
  test('exactly on a midpoint counts as after it (deterministic tie-break)', () => {
    expect(insertIndexForX(mids, 150)).toBe(2) // clientX < mid is strict → 150 is not < 150
  })
})

describe('bodyOwnsMessageBindingDrops (the split shield yields to the chat composer)', () => {
  test('the chat body owns its drops → GroupView suppresses the split shield', () => {
    // Regression guard for "dragging an open editor tab onto the composer does
    // nothing": the shield used to cover the composer during a tab drag and
    // steal the drop. GroupView renders the shield only when this is false.
    expect(bodyOwnsMessageBindingDrops('chat')).toBe(true)
  })

  test('every other body keeps the shield (split/move over the whole body)', () => {
    for (const kind of ['file', 'diff', 'terminal', 'preview', 'table', 'settings'] as const) {
      expect(bodyOwnsMessageBindingDrops(kind)).toBe(false)
    }
  })

  test('an empty group (no active body) keeps the shield', () => {
    expect(bodyOwnsMessageBindingDrops(undefined)).toBe(false)
  })
})
