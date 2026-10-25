import { describe, expect, test } from 'bun:test'
import type { CapabilityRule } from '@/shared/api/contracts'
import { markUnshipped } from './permissionRuleRows'

const rule = (action: string, effect: CapabilityRule['effect'] = 'allow'): CapabilityRule => ({
  action,
  resource: '*',
  effect,
})

const shipped = [rule('tool:*', 'deny'), rule('tool:read'), rule('tool:bash')]

describe('marking the rules the product does not ship', () => {
  test('a scope that matches what we ship marks nothing', () => {
    expect(markUnshipped(shipped, shipped)).toEqual([false, false, false])
  })

  /**
   * The reason this is content-based. Order is part of the policy, but a marker per row that
   * answered "is this position different" lit every row a dragged rule passed — a wall of
   * warning colour for one move, saying nothing anyone could act on.
   */
  test('reordering the shipped rules marks nothing', () => {
    const reordered = [shipped[1]!, shipped[2]!, shipped[0]!]

    expect(markUnshipped(reordered, shipped)).toEqual([false, false, false])
  })

  test('an added rule marks, and only it', () => {
    const withExtra = [...shipped, rule('tool:write')]

    expect(markUnshipped(withExtra, shipped)).toEqual([false, false, false, true])
  })

  test('an edited effect marks that row', () => {
    const edited = [shipped[0]!, rule('tool:read', 'ask'), shipped[2]!]

    expect(markUnshipped(edited, shipped)).toEqual([false, true, false])
  })

  /** Counted, not set-tested: a second copy of a rule we ship once is somebody's addition. */
  test('a duplicate of a shipped rule marks the copy', () => {
    const duplicated = [...shipped, rule('tool:read')]

    expect(markUnshipped(duplicated, shipped)).toEqual([false, false, false, true])
  })

  test('a scope with no shipped default never marks', () => {
    expect(markUnshipped(shipped, null)).toEqual([false, false, false])
  })
})
