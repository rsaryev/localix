import { describe, expect, test } from 'bun:test'
import type { GridNode, GroupRole } from '@/entities/workspace-grid/model'
import {
  computeLayout,
  maximizedLayout,
  clampToMin,
  capMin,
  minWidthOf,
  minHeightOf,
  resolveGridLayout,
} from './layout'

const leaf = (id: string): GridNode => ({ type: 'leaf', id, tabs: [], activeTab: null })
const roleLeaf = (id: string, role: GroupRole): GridNode => ({
  type: 'leaf',
  id,
  tabs: [],
  activeTab: null,
  role,
})

describe('computeLayout', () => {
  test('single leaf fills the container', () => {
    const { leaves, separators } = computeLayout(leaf('g1'))
    expect(leaves).toHaveLength(1)
    expect(leaves[0].leaf.id).toBe('g1')
    expect(leaves[0].rect).toEqual({ left: 0, top: 0, width: 100, height: 100 })
    expect(separators).toHaveLength(0)
  })

  test('horizontal branch splits width by sizes and adds one separator', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('g1'), leaf('g2')],
      sizes: [0.38, 0.62],
    }
    const { leaves, separators } = computeLayout(root)
    expect(leaves.map((l) => l.leaf.id)).toEqual(['g1', 'g2'])
    expect(leaves[0].rect.width).toBeCloseTo(38)
    expect(leaves[1].rect.left).toBeCloseTo(38)
    expect(leaves[1].rect.width).toBeCloseTo(62)
    expect(separators).toHaveLength(1)
    expect(separators[0].orientation).toBe('h')
  })

  test('vertical branch splits height by sizes; separator is horizontal', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'v',
      children: [leaf('g1'), leaf('g2')],
      sizes: [0.7, 0.3],
    }
    const { leaves, separators } = computeLayout(root)
    expect(leaves[0].rect.height).toBeCloseTo(70)
    expect(leaves[1].rect.top).toBeCloseTo(70)
    expect(leaves[1].rect.height).toBeCloseTo(30)
    expect(separators[0].orientation).toBe('v')
    expect(separators[0].branchRect).toEqual({ left: 0, top: 0, width: 100, height: 100 })
  })

  test('nested branch: inner separator branchRect is the SUB-box (resize math invariant)', () => {
    // chat | (editor / bottom) — the right half holds a vertical split. The inner
    // separator's branchRect must be that right SUB-box, not the whole container,
    // or the resize drag (px delta ÷ branchRect span) would be off.
    const root: GridNode = {
      type: 'branch',
      id: 'outer',
      orientation: 'h',
      sizes: [0.4, 0.6],
      children: [
        leaf('chat'),
        {
          type: 'branch',
          id: 'inner',
          orientation: 'v',
          sizes: [0.7, 0.3],
          children: [leaf('ed'), leaf('term')],
        },
      ],
    }
    const { leaves, separators } = computeLayout(root)
    // chat occupies the left 40%, the inner split the right 60%.
    expect(leaves.find((l) => l.leaf.id === 'chat')!.rect.width).toBeCloseTo(40)
    const ed = leaves.find((l) => l.leaf.id === 'ed')!
    expect(ed.rect.left).toBeCloseTo(40)
    expect(ed.rect.width).toBeCloseTo(60)
    expect(ed.rect.height).toBeCloseTo(70) // 70% of full height
    const innerSep = separators.find((s) => s.branch.id === 'inner')!
    expect(innerSep.branchRect).toMatchObject({ left: 40, top: 0, width: 60, height: 100 })
    const outerSep = separators.find((s) => s.branch.id === 'outer')!
    expect(outerSep.branchRect).toMatchObject({ left: 0, top: 0, width: 100, height: 100 })
  })

  test('leaf ids (React keys) are stable regardless of tree shape', () => {
    // The same leaf id appears whether it is the root or nested under a branch —
    // that stability is what keeps a group from remounting on a split.
    const flat = computeLayout(leaf('g1')).leaves.map((l) => l.leaf.id)
    const nested = computeLayout({
      type: 'branch',
      id: 'b',
      orientation: 'v',
      children: [leaf('g1'), leaf('g2')],
      sizes: [0.5, 0.5],
    }).leaves.map((l) => l.leaf.id)
    expect(flat).toContain('g1')
    expect(nested).toContain('g1')
  })

  test('with a viewport, enforces the per-group minimum width (no compounded sliver)', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('big'), leaf('sliver')],
      sizes: [0.95, 0.05],
    }
    const { leaves } = computeLayout(root, undefined, {
      viewport: { width: 1000, height: 800 },
      minWidth: 240,
      minHeight: 120,
    })
    const sliver = leaves.find((l) => l.leaf.id === 'sliver')!
    expect((sliver.rect.width / 100) * 1000).toBeCloseTo(240, 0) // 5% (50px) clamped up to 240px
  })

  test('maximizedLayout keeps all leaves mounted, hiding the non-maximized', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('g1'), leaf('g2')],
      sizes: [0.5, 0.5],
    }
    const { leaves } = maximizedLayout(root, 'g2')
    expect(leaves.map((l) => l.leaf.id).sort()).toEqual(['g1', 'g2'])
    expect(leaves.find((l) => l.leaf.id === 'g1')!.hidden).toBe(true)
    expect(leaves.find((l) => l.leaf.id === 'g2')!.hidden).toBe(false)
  })

  test('mobile shows only the focused group full-size without changing the split tree', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('chat'), leaf('workbench')],
      sizes: [0.4, 0.6],
    }
    const mobile = resolveGridLayout(root, {
      isMobile: true,
      activeGroup: 'workbench',
      maximizedGroup: null,
    })
    expect(mobile.separators).toHaveLength(0)
    expect(mobile.leaves.find((slot) => slot.leaf.id === 'chat')?.hidden).toBe(true)
    expect(mobile.leaves.find((slot) => slot.leaf.id === 'workbench')).toMatchObject({
      hidden: false,
      rect: { left: 0, top: 0, width: 100, height: 100 },
    })

    const desktop = resolveGridLayout(root, {
      isMobile: false,
      activeGroup: 'workbench',
      maximizedGroup: null,
    })
    expect(desktop.separators).toHaveLength(1)
    expect(desktop.leaves.every((slot) => !slot.hidden)).toBe(true)
  })
})

describe('clampToMin', () => {
  test('leaves sizes unchanged when all already meet the minimum', () => {
    const r = clampToMin([0.5, 0.5], 1000, 240) // 500/500, both ≥ 240
    expect(r[0]).toBeCloseTo(0.5, 5)
    expect(r[1]).toBeCloseTo(0.5, 5)
  })

  test('raises a sliver to the minimum, taking the deficit from larger siblings proportionally', () => {
    const r = clampToMin([0.35, 0.52, 0.13], 1500, 240) // the 13% (195px) panel is below 240
    expect(r[2] * 1500).toBeCloseTo(240, 0) // sliver hits the floor exactly
    expect(r[0] + r[1] + r[2]).toBeCloseTo(1, 5) // normalized
    expect(r[1]).toBeGreaterThan(r[0]) // the largest donates more but stays largest
    expect(r[0] * 1500).toBeGreaterThanOrEqual(240 - 1e-3) // donors never dip below the floor
  })

  test('degrades to an even split when the minimums cannot all fit', () => {
    const r = clampToMin([0.8, 0.1, 0.1], 600, 240) // 3·240 = 720 > 600
    expect(r).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  test('passes through trivial inputs (single child / no minimum)', () => {
    expect(clampToMin([1], 1000, 240)).toEqual([1])
    expect(clampToMin([0.5, 0.5], 1000, 0)).toEqual([0.5, 0.5])
  })

  test('per-child minimums: a content-heavy child can demand more than its sibling', () => {
    // c0 needs 600px, c1 only 200; an even 500/500 must give c0 its 600.
    const r = clampToMin([0.5, 0.5], 1000, [600, 200])
    expect(r[0] * 1000).toBeCloseTo(600, 0)
    expect(r[1] * 1000).toBeCloseTo(400, 0)
  })

  test('infeasible per-child minimums split PROPORTIONAL to the minimums (not even)', () => {
    // 300 + 100 = 400 = span → the bigger-min child keeps the larger share.
    const r = clampToMin([0.5, 0.5], 400, [300, 100])
    expect(r[0]).toBeCloseTo(0.75, 5)
    expect(r[1]).toBeCloseTo(0.25, 5)
  })
})

describe('capMin (never let minimums pin a split)', () => {
  test('passes the role minimum through on a roomy branch', () => {
    expect(capMin(360, 1200, 2)).toBe(360) // 360 < 1200*0.8/2=480 → unchanged
  })
  test('caps so two children always leave a resizable margin on a narrow branch', () => {
    // editor 360 + aux 340 = 700 would fill a 740px grid (pinned); capped they don't.
    const a = capMin(360, 740, 2) // 740*0.8/2 = 296
    const b = capMin(340, 740, 2)
    expect(a).toBeCloseTo(296, 0)
    expect(b).toBeCloseTo(296, 0)
    expect((a + b) / 740).toBeLessThan(0.85) // free play remains → draggable
  })
  test('trivial guards', () => {
    expect(capMin(360, 0, 2)).toBe(360)
    expect(capMin(360, 1000, 0)).toBe(360)
  })
})

describe('minWidthOf / minHeightOf (role-derived minimums)', () => {
  test('a leaf wants its role minimum; untagged falls back', () => {
    expect(minWidthOf(roleLeaf('e', 'editor'))).toBe(360)
    expect(minWidthOf(roleLeaf('a', 'aux'))).toBe(340)
    expect(minWidthOf(leaf('x'))).toBe(240) // untagged → default fallback
    expect(minWidthOf(leaf('x'), 999)).toBe(999) // explicit fallback honored
  })

  test('a horizontal branch sums child widths; a vertical branch takes the max', () => {
    const sideBySide: GridNode = {
      type: 'branch',
      id: 'h',
      orientation: 'h',
      children: [roleLeaf('e', 'editor'), roleLeaf('a', 'aux')],
      sizes: [0.5, 0.5],
    }
    expect(minWidthOf(sideBySide)).toBe(700) // 360 + 340
    const stacked: GridNode = {
      type: 'branch',
      id: 'v',
      orientation: 'v',
      children: [roleLeaf('a', 'aux'), roleLeaf('e', 'editor')],
      sizes: [0.5, 0.5],
    }
    expect(minWidthOf(stacked)).toBe(360) // max(340, 360) — same column, widest wins
  })

  test('height minimums mirror width (vertical sums, horizontal maxes; role-agnostic)', () => {
    expect(minHeightOf(roleLeaf('a', 'aux'))).toBe(120)
    const stacked: GridNode = {
      type: 'branch',
      id: 'v',
      orientation: 'v',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    }
    expect(minHeightOf(stacked)).toBe(240) // 120 + 120
  })
})

describe('computeLayout enforces role-derived minimum widths', () => {
  test('a crushed aux panel is raised to the aux minimum, not the generic floor', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [roleLeaf('ed', 'editor'), roleLeaf('aux', 'aux')],
      sizes: [0.9, 0.1], // aux at 10% would be ~140px on a 1400px viewport
    }
    const { leaves } = computeLayout(root, undefined, {
      viewport: { width: 1400, height: 800 },
      minWidth: 240,
      minHeight: 120,
    })
    const aux = leaves.find((l) => l.leaf.id === 'aux')!
    expect((aux.rect.width / 100) * 1400).toBeCloseTo(340, 0) // aux min, well above the 240 generic floor
  })
})
