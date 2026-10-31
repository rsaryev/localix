import { describe, expect, test } from 'bun:test'
import { rovingTarget } from './roving'

describe('rovingTarget', () => {
  const items = [{}, { disabled: true }, {}, {}]

  test('arrows step over disabled tabs and wrap at the ends', () => {
    expect(rovingTarget(items, 0, 'ArrowRight')).toBe(2)
    expect(rovingTarget(items, 2, 'ArrowLeft')).toBe(0)
    expect(rovingTarget(items, 3, 'ArrowRight')).toBe(0)
  })

  test('Home/End jump to the first/last enabled tab; other keys are not handled', () => {
    expect(rovingTarget([{ disabled: true }, {}, {}], 2, 'Home')).toBe(1)
    expect(rovingTarget(items, 0, 'End')).toBe(3)
    expect(rovingTarget(items, 0, 'Enter')).toBeNull()
    expect(rovingTarget([{ disabled: true }], 0, 'End')).toBe(-1)
  })
})

const E = false
const D = true
/** Build a tab list from enabled/disabled flags (true = disabled). */
const tabs = (...disabled: boolean[]) => disabled.map((d) => ({ disabled: d }))
const step = (items: { disabled?: boolean }[], start: number, dir: 1 | -1) =>
  rovingTarget(items, start, dir === 1 ? 'ArrowRight' : 'ArrowLeft')
const edge = (items: { disabled?: boolean }[], which: 'first' | 'last') =>
  rovingTarget(items, 0, which === 'first' ? 'Home' : 'End')

describe('rovingTarget: arrow steps', () => {
  test('steps to the adjacent enabled tab', () => {
    expect(step(tabs(E, E, E), 0, 1)).toBe(1)
    expect(step(tabs(E, E, E), 1, -1)).toBe(0)
  })

  test('skips disabled tabs in the step direction', () => {
    expect(step(tabs(E, D, E), 0, 1)).toBe(2)
    expect(step(tabs(E, D, E), 2, -1)).toBe(0)
  })

  test('wraps around the ends', () => {
    expect(step(tabs(E, E, E), 2, 1)).toBe(0)
    expect(step(tabs(E, E, E), 0, -1)).toBe(2)
  })

  test('wraps past trailing/leading disabled tabs', () => {
    expect(step(tabs(E, E, D), 1, 1)).toBe(0)
    expect(step(tabs(D, E, E), 1, -1)).toBe(2)
  })

  test('returns the start index when it is the only enabled tab', () => {
    expect(step(tabs(D, E, D), 1, 1)).toBe(1)
    expect(step(tabs(D, E, D), 1, -1)).toBe(1)
  })

  test('returns -1 when every tab is disabled or the list is empty', () => {
    expect(step(tabs(D, D), 0, 1)).toBe(-1)
    expect(step([], 0, 1)).toBe(-1)
  })
})

describe('rovingTarget: Home and End', () => {
  test('finds the first/last enabled tab', () => {
    expect(edge(tabs(E, E, E), 'first')).toBe(0)
    expect(edge(tabs(E, E, E), 'last')).toBe(2)
  })

  test('skips disabled tabs at the edges', () => {
    expect(edge(tabs(D, E, D), 'first')).toBe(1)
    expect(edge(tabs(D, E, D), 'last')).toBe(1)
  })

  test('returns -1 when every tab is disabled or the list is empty', () => {
    expect(edge(tabs(D, D), 'first')).toBe(-1)
    expect(edge([], 'last')).toBe(-1)
  })
})
