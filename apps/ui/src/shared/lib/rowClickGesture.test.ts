import { describe, it, expect } from 'bun:test'
import { isRowSelectClick, ROW_CLICK_MAX_TRAVEL_PX } from '@localixai/plugin-sdk/ui/utilities'

describe('isRowSelectClick', () => {
  it('treats a still press→release as a click', () => {
    expect(isRowSelectClick({ x: 100, y: 100 }, { x: 100, y: 100 }, false)).toBe(true)
  })

  it('tolerates trackpad-tap jitter under the threshold', () => {
    expect(isRowSelectClick({ x: 100, y: 100 }, { x: 102, y: 101 }, false)).toBe(true)
  })

  it('counts travel exactly at the threshold as a click (inclusive)', () => {
    expect(isRowSelectClick({ x: 0, y: 0 }, { x: ROW_CLICK_MAX_TRAVEL_PX, y: 0 }, false)).toBe(true)
  })

  it('rejects a gesture that moved past the threshold', () => {
    expect(isRowSelectClick({ x: 0, y: 0 }, { x: 40, y: 0 }, false)).toBe(false)
  })

  it('never selects once a native drag has started, even without movement', () => {
    expect(isRowSelectClick({ x: 100, y: 100 }, { x: 100, y: 100 }, true)).toBe(false)
  })

  it('selects when there is no pointerdown origin (synthetic click)', () => {
    expect(isRowSelectClick(null, { x: 100, y: 100 }, false)).toBe(true)
  })

  it('honours a custom travel budget', () => {
    expect(isRowSelectClick({ x: 0, y: 0 }, { x: 10, y: 0 }, false, 12)).toBe(true)
    expect(isRowSelectClick({ x: 0, y: 0 }, { x: 10, y: 0 }, false, 4)).toBe(false)
  })
})
