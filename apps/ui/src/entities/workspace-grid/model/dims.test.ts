import { describe, expect, it } from 'bun:test'
import { BASE_DIMS, MIN_GROUP_H, MIN_GROUP_W, ROLE_MIN_W, minWidthOf, scaleDims } from './dims'
import type { GridNode } from './tree'

const leaf = (id: string, role?: 'editor' | 'aux'): GridNode => ({
  type: 'leaf',
  id,
  tabs: [],
  activeTab: null,
  role,
})

describe('scaleDims (density-ratio scaling of the 14px-baseline minimums)', () => {
  it('ratio 1 returns BASE_DIMS itself — byte-identical to the unscaled constants', () => {
    const dims = scaleDims(1)
    expect(dims).toBe(BASE_DIMS)
    expect(dims.minGroupW).toBe(MIN_GROUP_W)
    expect(dims.minGroupH).toBe(MIN_GROUP_H)
    expect(dims.roleMinW).toBe(ROLE_MIN_W)
  })

  it('scales every minimum linearly by the ratio', () => {
    const ratio = 16 / 14 // xl density: 16px root
    const dims = scaleDims(ratio)
    expect(dims.minGroupW).toBe(MIN_GROUP_W * ratio)
    expect(dims.minGroupH).toBe(MIN_GROUP_H * ratio)
    for (const role of Object.keys(ROLE_MIN_W) as (keyof typeof ROLE_MIN_W)[]) {
      expect(dims.roleMinW[role]).toBe(ROLE_MIN_W[role] * ratio)
    }
  })

  it('shrinks below baseline for a sub-1 ratio (sm density)', () => {
    const dims = scaleDims(13 / 14)
    expect(dims.roleMinW.editor).toBeCloseTo(360 * (13 / 14), 10)
  })

  it('guards invalid ratios (SSR/tests) back to the baseline', () => {
    expect(scaleDims(0)).toBe(BASE_DIMS)
    expect(scaleDims(-2)).toBe(BASE_DIMS)
    expect(scaleDims(Number.NaN)).toBe(BASE_DIMS)
    expect(scaleDims(Number.POSITIVE_INFINITY)).toBe(BASE_DIMS)
  })

  it('threads through minWidthOf so subtree minimums scale with it', () => {
    const ratio = 16 / 14
    const dims = scaleDims(ratio)
    const sideBySide: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      sizes: [0.5, 0.5],
      children: [leaf('e', 'editor'), leaf('a', 'aux')],
    }
    expect(minWidthOf(sideBySide, dims.minGroupW, dims.roleMinW)).toBe((360 + 340) * ratio)
    // Untagged leaf falls back to the scaled generic floor.
    expect(minWidthOf(leaf('x'), dims.minGroupW, dims.roleMinW)).toBe(240 * ratio)
    // Default args unchanged — the 14px-baseline behavior is untouched.
    expect(minWidthOf(sideBySide)).toBe(700)
  })
})
