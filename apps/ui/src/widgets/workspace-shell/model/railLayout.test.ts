import { describe, expect, it } from 'bun:test'
import {
  computeDropIndex,
  emptyRailLayout,
  moveRailItem,
  moveWithinBar,
  parseRailLayout,
  resetRailLayout,
  resolveRailAreas,
  serializeRailLayout,
  type RailItemDef,
} from './railLayout'

// A representative heterogeneous set: sections default to the bar (db → overflow),
// viewlets split bar/overflow, matching the real ChatPage wiring.
const DEFS: RailItemDef[] = [
  { id: 'section:files', defaultArea: 'bar' },
  { id: 'section:database', defaultArea: 'overflow' },
  { id: 'section:docker', defaultArea: 'overflow' },
  { id: 'viewlet:changes', defaultArea: 'bar' },
  { id: 'viewlet:notes', defaultArea: 'bar' },
  { id: 'viewlet:terminal', defaultArea: 'bar' },
  { id: 'viewlet:activity', defaultArea: 'overflow' },
  { id: 'viewlet:stats', defaultArea: 'overflow' },
  { id: 'viewlet:search', defaultArea: 'top' },
  { id: 'utility:reset', defaultArea: 'status' },
]

describe('resolveRailAreas · non-placeable entries', () => {
  // Entries explicitly marked non-placeable must ignore saved visible placements.
  const DEFS_WITH_MINI_APP: RailItemDef[] = [
    { id: 'section:files', defaultArea: 'bar' },
    { id: 'viewlet:reader', defaultArea: 'overflow', placeable: false },
  ]

  it('forces a non-placeable entry to overflow even when the saved layout pinned it', () => {
    const areas = resolveRailAreas(DEFS_WITH_MINI_APP, {
      entries: [
        { id: 'viewlet:reader', area: 'bar' },
        { id: 'section:files', area: 'bar' },
      ],
    })
    expect(areas.bar).toEqual(['section:files'])
    expect(areas.overflow).toEqual(['viewlet:reader'])
  })

  it('forces it to overflow from every visible zone, not just the bar', () => {
    for (const area of ['top', 'bar', 'bottom', 'status'] as const) {
      const areas = resolveRailAreas(DEFS_WITH_MINI_APP, {
        entries: [{ id: 'viewlet:reader', area }],
      })
      expect(areas[area]).not.toContain('viewlet:reader')
      expect(areas.overflow).toContain('viewlet:reader')
    }
  })

  it('still honors a saved placement for a placeable entry', () => {
    const areas = resolveRailAreas(DEFS_WITH_MINI_APP, {
      entries: [{ id: 'section:files', area: 'status' }],
    })
    expect(areas.status).toEqual(['section:files'])
    expect(areas.bar).toEqual([])
  })
})

describe('resolveRailAreas', () => {
  it('uses default areas + def order when no state is saved', () => {
    const { top, bar, bottom, status, overflow } = resolveRailAreas(DEFS, null)
    expect(bar).toEqual(['section:files', 'viewlet:changes', 'viewlet:notes', 'viewlet:terminal'])
    expect(overflow).toEqual([
      'section:database',
      'section:docker',
      'viewlet:activity',
      'viewlet:stats',
    ])
    expect(top).toEqual(['viewlet:search'])
    expect(bottom).toEqual([])
    expect(status).toEqual(['utility:reset'])
  })

  it('honors saved order + area and appends NEW defs to their default area', () => {
    // A saved layout that predates `viewlet:stats` and `section:docker`.
    const state = {
      entries: [
        { id: 'viewlet:notes', area: 'bar' as const },
        { id: 'section:files', area: 'bar' as const },
        { id: 'section:database', area: 'bar' as const }, // user pinned db to the bar
        { id: 'viewlet:activity', area: 'overflow' as const },
      ],
    }
    const { top, bar, bottom, status, overflow } = resolveRailAreas(DEFS, state)
    // Saved bar order preserved, then unknown-to-state defs appended in def order.
    expect(bar).toEqual([
      'viewlet:notes',
      'section:files',
      'section:database',
      'viewlet:changes',
      'viewlet:terminal',
    ])
    // Saved overflow first, then the not-yet-placed overflow default (stats) +
    // docker (defaultArea overflow) appended in def order.
    expect(overflow).toEqual(['viewlet:activity', 'section:docker', 'viewlet:stats'])
    expect(top).toEqual(['viewlet:search'])
    expect(bottom).toEqual([])
    expect(status).toEqual(['utility:reset'])
  })

  it('drops stale ids that no longer exist among the defs', () => {
    const state = {
      entries: [
        { id: 'viewlet:removed-mini-app', area: 'bar' as const },
        { id: 'section:files', area: 'bar' as const },
      ],
    }
    const { bar } = resolveRailAreas(DEFS, state)
    expect(bar).not.toContain('viewlet:removed-mini-app')
    expect(bar[0]).toBe('section:files')
  })

  it('ignores duplicate ids in saved state', () => {
    const state = {
      entries: [
        { id: 'section:files', area: 'bar' as const },
        { id: 'section:files', area: 'overflow' as const },
      ],
    }
    const { bar, overflow } = resolveRailAreas(DEFS, state)
    expect(bar.filter((x) => x === 'section:files')).toHaveLength(1)
    expect(overflow).not.toContain('section:files')
  })
})

describe('moveRailItem', () => {
  it('reorders within the bar', () => {
    const next = moveRailItem(DEFS, null, 'viewlet:terminal', 'bar', 0)
    const { bar } = resolveRailAreas(DEFS, next)
    expect(bar[0]).toBe('viewlet:terminal')
    expect(bar).toEqual(['viewlet:terminal', 'section:files', 'viewlet:changes', 'viewlet:notes'])
  })

  it('moves an item across areas and keeps every id exactly once', () => {
    const next = moveRailItem(DEFS, null, 'section:database', 'bar', 1)
    const { top, bar, bottom, status, overflow } = resolveRailAreas(DEFS, next)
    expect(bar).toContain('section:database')
    expect(overflow).not.toContain('section:database')
    const all = [...top, ...bar, ...bottom, ...status, ...overflow].sort()
    expect(all).toEqual(DEFS.map((d) => d.id).sort())
  })

  it('moves an item to the lower rail and back to the workspace', () => {
    const lower = moveRailItem(DEFS, null, 'viewlet:notes', 'bottom', 1)
    expect(resolveRailAreas(DEFS, lower).bottom).toEqual(['viewlet:notes'])
    const workspace = moveRailItem(DEFS, lower, 'viewlet:notes', 'bar', 0)
    expect(resolveRailAreas(DEFS, workspace).bar[0]).toBe('viewlet:notes')
    expect(resolveRailAreas(DEFS, workspace).bottom).toEqual([])
  })

  it('moves entries among top, workspace, lower, and status zones', () => {
    const top = moveRailItem(DEFS, null, 'viewlet:notes', 'top', 1)
    expect(resolveRailAreas(DEFS, top).top).toEqual(['viewlet:search', 'viewlet:notes'])
    const lower = moveRailItem(DEFS, top, 'viewlet:notes', 'bottom', 0)
    expect(resolveRailAreas(DEFS, lower).bottom).toEqual(['viewlet:notes'])
    const status = moveRailItem(DEFS, lower, 'viewlet:notes', 'status', 1)
    expect(resolveRailAreas(DEFS, status).status).toEqual(['utility:reset', 'viewlet:notes'])
  })

  it('clamps an out-of-range index', () => {
    const next = moveRailItem(DEFS, null, 'section:files', 'bar', 999)
    const { bar } = resolveRailAreas(DEFS, next)
    expect(bar[bar.length - 1]).toBe('section:files')
  })

  it('is a no-op for an unknown id', () => {
    const next = moveRailItem(DEFS, null, 'does:not-exist', 'bar', 0)
    expect(resolveRailAreas(DEFS, next)).toEqual(resolveRailAreas(DEFS, null))
  })
})

describe('moveWithinBar', () => {
  // Default bar: [files, source-control, notes, terminal].
  it('moves an entry down one position from the middle', () => {
    const next = moveWithinBar(DEFS, null, 'viewlet:changes', 1)
    expect(resolveRailAreas(DEFS, next).bar).toEqual([
      'section:files',
      'viewlet:notes',
      'viewlet:changes',
      'viewlet:terminal',
    ])
  })

  it('moves an entry up one position from the middle', () => {
    const next = moveWithinBar(DEFS, null, 'viewlet:notes', -1)
    expect(resolveRailAreas(DEFS, next).bar).toEqual([
      'section:files',
      'viewlet:notes',
      'viewlet:changes',
      'viewlet:terminal',
    ])
  })

  it('clamps at the top edge (first entry moved up stays first)', () => {
    const next = moveWithinBar(DEFS, null, 'section:files', -1)
    expect(resolveRailAreas(DEFS, next).bar).toEqual(resolveRailAreas(DEFS, null).bar)
  })

  it('clamps at the bottom edge (last entry moved down stays last)', () => {
    const next = moveWithinBar(DEFS, null, 'viewlet:terminal', 5)
    expect(resolveRailAreas(DEFS, next).bar).toEqual(resolveRailAreas(DEFS, null).bar)
  })

  it('is a no-op for an unknown id', () => {
    const state = moveRailItem(DEFS, null, 'viewlet:notes', 'bar', 0)
    expect(moveWithinBar(DEFS, state, 'section:nope', 1)).toEqual(state)
  })

  it('is a no-op for an entry sitting in the overflow', () => {
    const before = resolveRailAreas(DEFS, null)
    const next = moveWithinBar(DEFS, null, 'viewlet:stats', -1)
    expect(resolveRailAreas(DEFS, next)).toEqual(before)
  })

  it('never changes the overflow list', () => {
    const next = moveWithinBar(DEFS, null, 'viewlet:notes', 1)
    expect(resolveRailAreas(DEFS, next).overflow).toEqual(resolveRailAreas(DEFS, null).overflow)
  })
})

describe('reset', () => {
  it('clears every explicit placement', () => {
    const moved = moveRailItem(DEFS, null, 'viewlet:notes', 'status', 0)
    expect(resetRailLayout()).toEqual(emptyRailLayout())
    expect(resolveRailAreas(DEFS, resetRailLayout())).toEqual(resolveRailAreas(DEFS, null))
    // sanity: the moved state genuinely differed
    expect(resolveRailAreas(DEFS, moved).bar).not.toContain('viewlet:notes')
  })
})

describe('computeDropIndex', () => {
  const bar = ['a', 'b', 'c', 'd']

  it('drops before the target (excludes the dragged item)', () => {
    // Drag 'd' before 'b'. Filtered = [a,b,c]; target b at 1; before → 1.
    expect(computeDropIndex(bar, 'd', 'b', false)).toBe(1)
  })

  it('drops after the target', () => {
    expect(computeDropIndex(bar, 'd', 'b', true)).toBe(2)
  })

  it('accounts for the dragged item sitting BEFORE the target', () => {
    // Drag 'a' after 'c'. Filtered = [b,c,d]; c at 1; after → 2.
    expect(computeDropIndex(bar, 'a', 'c', true)).toBe(2)
  })

  it('dropping an item on itself is a stable no-op index', () => {
    // Filtered removes 'b'; target 'b' gone → append. Callers guard self-drops,
    // but the math must not throw or land negative.
    expect(computeDropIndex(bar, 'b', 'b', false)).toBe(3)
  })

  it('appends when the target no longer exists', () => {
    expect(computeDropIndex(bar, 'a', 'zzz', false)).toBe(3)
  })
})

describe('parseRailLayout', () => {
  it('returns null for empty / malformed input', () => {
    expect(parseRailLayout(null)).toBeNull()
    expect(parseRailLayout('')).toBeNull()
    expect(parseRailLayout('{not json')).toBeNull()
    expect(parseRailLayout('42')).toBeNull()
    expect(parseRailLayout('"a string"')).toBeNull()
  })

  it('parses the current envelope', () => {
    const raw = serializeRailLayout({
      entries: [
        { id: 'section:files', area: 'bar' },
        { id: 'viewlet:search', area: 'top' },
        { id: 'utility:reset', area: 'status' },
        { id: 'viewlet:stats', area: 'overflow' },
      ],
    })
    expect(parseRailLayout(raw)).toEqual({
      entries: [
        { id: 'section:files', area: 'bar' },
        { id: 'viewlet:search', area: 'top' },
        { id: 'utility:reset', area: 'status' },
        { id: 'viewlet:stats', area: 'overflow' },
      ],
    })
  })

  it('drops a layout saved under another version or shape', () => {
    expect(
      parseRailLayout(JSON.stringify({ v: 4, entries: [{ id: 'a', area: 'bar' }] })),
    ).toBeNull()
    expect(parseRailLayout('["viewlet:notes","section:files"]')).toBeNull()
    expect(parseRailLayout(JSON.stringify({ order: ['section:files'] }))).toBeNull()
  })

  it('round-trips through serialize', () => {
    const state = { entries: [{ id: 'section:files', area: 'bar' as const }] }
    expect(parseRailLayout(serializeRailLayout(state))).toEqual(state)
  })
})
