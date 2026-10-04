import { describe, expect, test } from 'bun:test'
import {
  WARM_LIMIT,
  bumpWarm,
  dropTabFromScopeActive,
  pruneScopeActive,
  recordScopeActive,
  forgetScope,
} from './warm'
import { GLOBAL_SCOPE } from './scope'

describe('bumpWarm', () => {
  test('moves a scope to the front, dedupes, ignores GLOBAL', () => {
    expect(bumpWarm([], 'A')).toEqual(['A'])
    expect(bumpWarm(['A'], 'B')).toEqual(['B', 'A'])
    expect(bumpWarm(['B', 'A'], 'A')).toEqual(['A', 'B'])
    expect(bumpWarm(['A'], GLOBAL_SCOPE)).toEqual(['A'])
  })

  test('caps the warm set at WARM_LIMIT, evicting the oldest', () => {
    let warm: string[] = []
    for (const s of ['A', 'B', 'C', 'D', 'E']) warm = bumpWarm(warm, s)
    expect(warm).toHaveLength(WARM_LIMIT)
    expect(warm[0]).toBe('E')
    expect(warm).not.toContain('A')
  })
})

describe('recordScopeActive / forgetScope', () => {
  test('records recent tabs per (scope, group), newest first', () => {
    let m = recordScopeActive({}, 'A', 'g1', 'file:a')
    m = recordScopeActive(m, 'A', 'g2', 'file:b')
    m = recordScopeActive(m, 'B', 'g1', 'file:c')
    expect(m).toEqual({ A: { g1: ['file:a'], g2: ['file:b'] }, B: { g1: ['file:c'] } })
  })

  test('the MRU dedupes, caps at TAB_WARM_LIMIT and is a no-op re-recording the newest', () => {
    let m = recordScopeActive({}, 'A', 'g1', 'a')
    const same = recordScopeActive(m, 'A', 'g1', 'a')
    expect(same).toBe(m) // no churn re-recording the front
    for (const id of ['b', 'c', 'd']) m = recordScopeActive(m, 'A', 'g1', id)
    expect(m.A!.g1).toEqual(['d', 'c', 'b']) // capped at 3, 'a' evicted
    m = recordScopeActive(m, 'A', 'g1', 'c')
    expect(m.A!.g1).toEqual(['c', 'd', 'b']) // re-activation moves to front, deduped
  })

  test('dropTabFromScopeActive removes a closed tab everywhere (same ref when absent)', () => {
    const m = { A: { g1: ['x', 'y'] }, B: { g1: ['y'] } }
    const dropped = dropTabFromScopeActive(m, 'y')
    expect(dropped).toEqual({ A: { g1: ['x'] }, B: {} })
    expect(dropTabFromScopeActive(m, 'zzz')).toBe(m)
  })

  test('forgetScope drops a scope from both the MRU and the tab memory', () => {
    const map = { A: { g1: ['x'] }, B: { g1: ['y'] } }
    const r = forgetScope(['B', 'A'], map, 'A')
    expect(r.warm).toEqual(['B'])
    expect(r.map).toEqual({ B: { g1: ['y'] } })
  })

  test('forgetScope is a no-op for an unknown scope', () => {
    const warm = ['A']
    const map = { A: { g1: ['x'] } }
    const r = forgetScope(warm, map, 'Z')
    expect(r.warm).toBe(warm)
    expect(r.map).toBe(map)
  })
})

describe('pruneScopeActive', () => {
  test('drops entries for scopes not in the keep set (bounds map growth)', () => {
    const map = {
      A: { g1: ['x'] },
      B: { g1: ['y'] },
      C: { g1: ['z'] },
      [GLOBAL_SCOPE]: { g1: ['g'] },
    }
    // Keep only the warm set (A, B) + active (A) + GLOBAL — C falls out.
    const r = pruneScopeActive(map, ['A', 'B', 'A', GLOBAL_SCOPE])
    expect(r).toEqual({ A: { g1: ['x'] }, B: { g1: ['y'] }, [GLOBAL_SCOPE]: { g1: ['g'] } })
  })

  test('returns the same ref when nothing is pruned (no churn)', () => {
    const map = { A: { g1: ['x'] } }
    expect(pruneScopeActive(map, ['A', GLOBAL_SCOPE])).toBe(map)
  })
})
