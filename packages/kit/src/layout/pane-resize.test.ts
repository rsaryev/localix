import { describe, expect, it } from 'bun:test'
import { clampPaneSize } from './pane-resize'

/**
 * The console's real numbers: the editor pane is [96, 600] px and the results half must
 * keep 132px (divider + toolbar + a couple of rows).
 */
const CONSOLE = { min: 96, max: 600, reserve: 132 }

describe('clampPaneSize — a persisted size must not outgrow its container', () => {
  it('leaves a size that fits alone', () => {
    expect(clampPaneSize({ ...CONSOLE, desired: 300, available: 800 })).toBe(300)
  })

  it('squeezes a stored size that no longer fits, keeping the reserve intact', () => {
    // The reported dead end: 600px restored into a 400px-tall console consumed the whole
    // panel — the grid collapsed to zero and the divider, the ONLY resize/reset handle,
    // sat below the visible area.
    expect(clampPaneSize({ ...CONSOLE, desired: 600, available: 400 })).toBe(268)
    expect(400 - clampPaneSize({ ...CONSOLE, desired: 600, available: 400 })).toBe(CONSOLE.reserve)
  })

  it('never returns less than min, even when the container cannot honour the reserve', () => {
    // 200px container: min + reserve = 228 does not fit. There is no good answer, but
    // pinning the pane at min keeps the divider on screen at y=96 — recoverable.
    expect(clampPaneSize({ ...CONSOLE, desired: 600, available: 200 })).toBe(96)
    expect(clampPaneSize({ ...CONSOLE, desired: 600, available: 0 })).toBe(96)
  })

  it('still honours the static max in a huge container', () => {
    expect(clampPaneSize({ ...CONSOLE, desired: 5000, available: 4000 })).toBe(600)
  })

  it('falls back to the static bounds before the container is measured', () => {
    expect(clampPaneSize({ ...CONSOLE, desired: 600, available: null })).toBe(600)
    expect(clampPaneSize({ ...CONSOLE, desired: 10, available: null })).toBe(96)
  })

  it('is a pure clamp of the DESIRED size, so growing the window restores the choice', () => {
    // Same desired value, three container sizes: the preference is never destroyed by a
    // temporary squeeze — that is why the hook persists `desired`, not the clamped size.
    const desired = 520
    expect(clampPaneSize({ ...CONSOLE, desired, available: 400 })).toBe(268)
    expect(clampPaneSize({ ...CONSOLE, desired, available: 600 })).toBe(468)
    expect(clampPaneSize({ ...CONSOLE, desired, available: 900 })).toBe(520)
  })

  it('applies no container bound when nothing is reserved', () => {
    // The sidebar-style caller that passes no `reserve`: a pane may fill its container.
    expect(clampPaneSize({ min: 96, max: 600, reserve: 0, desired: 500, available: 500 })).toBe(500)
  })
})
