import { describe, it, expect } from 'bun:test'
import { nextEnabledIndex, edgeEnabledIndex } from './keyboard'

const E = false
const D = true
/** Build a tab list from enabled/disabled flags (true = disabled). */
const tabs = (...disabled: boolean[]) => disabled.map((d) => ({ disabled: d }))

describe('nextEnabledIndex', () => {
  it('steps to the adjacent enabled tab', () => {
    expect(nextEnabledIndex(tabs(E, E, E), 0, 1)).toBe(1)
    expect(nextEnabledIndex(tabs(E, E, E), 1, -1)).toBe(0)
  })

  it('skips disabled tabs in the step direction', () => {
    expect(nextEnabledIndex(tabs(E, D, E), 0, 1)).toBe(2)
    expect(nextEnabledIndex(tabs(E, D, E), 2, -1)).toBe(0)
  })

  it('wraps around the ends', () => {
    expect(nextEnabledIndex(tabs(E, E, E), 2, 1)).toBe(0)
    expect(nextEnabledIndex(tabs(E, E, E), 0, -1)).toBe(2)
  })

  it('wraps past trailing/leading disabled tabs', () => {
    expect(nextEnabledIndex(tabs(E, E, D), 1, 1)).toBe(0)
    expect(nextEnabledIndex(tabs(D, E, E), 1, -1)).toBe(2)
  })

  it('returns the start index when it is the only enabled tab', () => {
    expect(nextEnabledIndex(tabs(D, E, D), 1, 1)).toBe(1)
    expect(nextEnabledIndex(tabs(D, E, D), 1, -1)).toBe(1)
  })

  it('returns -1 when every tab is disabled or the list is empty', () => {
    expect(nextEnabledIndex(tabs(D, D), 0, 1)).toBe(-1)
    expect(nextEnabledIndex([], 0, 1)).toBe(-1)
  })
})

describe('edgeEnabledIndex', () => {
  it('finds the first/last enabled tab', () => {
    expect(edgeEnabledIndex(tabs(E, E, E), 'first')).toBe(0)
    expect(edgeEnabledIndex(tabs(E, E, E), 'last')).toBe(2)
  })

  it('skips disabled tabs at the edges', () => {
    expect(edgeEnabledIndex(tabs(D, E, D), 'first')).toBe(1)
    expect(edgeEnabledIndex(tabs(D, E, D), 'last')).toBe(1)
  })

  it('returns -1 when every tab is disabled or the list is empty', () => {
    expect(edgeEnabledIndex(tabs(D, D), 'first')).toBe(-1)
    expect(edgeEnabledIndex([], 'last')).toBe(-1)
  })
})
