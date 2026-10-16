import { describe, expect, test } from 'bun:test'
import {
  expectNoRawOwners,
  expectOwnershipBoundary,
  ownershipBoundaryDifference,
} from './ownership-contract'

/**
 * Fixture paths, not real ones. They used to be four files that actually existed, which meant
 * deleting one of them broke a test about Map ordering — the harness cares only that the same
 * entries in a different order compare equal.
 */
const ALLOWLIST = new Map<string, number>([
  ['fixture/alpha.tsx', 1],
  ['fixture/beta.tsx', 1],
  ['fixture/gamma.tsx', 2],
  ['fixture/delta.tsx', 1],
])

/** Same content the allowlist declares, in the order a filesystem walk yields. */
const WALK_ORDER = new Map<string, number>([
  ['fixture/delta.tsx', 1],
  ['fixture/gamma.tsx', 2],
  ['fixture/beta.tsx', 1],
  ['fixture/alpha.tsx', 1],
])

function failureOf(assert: () => void): string {
  try {
    assert()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the ownership guard to fail, but it passed')
}

describe('ownership boundary harness', () => {
  test('accepts identical content discovered in a different order', () => {
    expect([...WALK_ORDER.keys()]).not.toEqual([...ALLOWLIST.keys()])
    expectOwnershipBoundary(WALK_ORDER, ALLOWLIST, 'textarea')
  })

  test('fails on a new offending file, and names it', () => {
    const withNewOffender = new Map(WALK_ORDER).set('plugins/example/ui/Workspace.tsx', 2)

    expect(ownershipBoundaryDifference(withNewOffender, ALLOWLIST)).toEqual({
      unexpected: ['plugins/example/ui/Workspace.tsx'],
      stale: [],
      changed: [],
    })

    const message = failureOf(() => expectOwnershipBoundary(withNewOffender, ALLOWLIST, 'textarea'))
    expect(message).toContain('plugins/example/ui/Workspace.tsx')
    expect(message).toContain('new raw <textarea> owners')
  })

  test('fails on a stale allowlist entry, and names it', () => {
    const withoutOwner = new Map(WALK_ORDER)
    withoutOwner.delete('fixture/gamma.tsx')

    expect(ownershipBoundaryDifference(withoutOwner, ALLOWLIST)).toEqual({
      unexpected: [],
      stale: ['fixture/gamma.tsx'],
      changed: [],
    })

    const message = failureOf(() => expectOwnershipBoundary(withoutOwner, ALLOWLIST, 'textarea'))
    expect(message).toContain('fixture/gamma.tsx')
    expect(message).toContain('stale <textarea> allowlist entries')
  })

  test('fails on a changed count for an allowlisted file, and names both counts', () => {
    const withMovedCount = new Map(WALK_ORDER).set('fixture/gamma.tsx', 3)

    expect(ownershipBoundaryDifference(withMovedCount, ALLOWLIST)).toEqual({
      unexpected: [],
      stale: [],
      changed: ['fixture/gamma.tsx (allowlisted 2, found 3)'],
    })

    const message = failureOf(() => expectOwnershipBoundary(withMovedCount, ALLOWLIST, 'textarea'))
    expect(message).toContain('allowlisted 2, found 3')
  })

  test('reports every difference class at once', () => {
    const drifted = new Map(WALK_ORDER)
    drifted.delete('fixture/delta.tsx')
    drifted.set('plugins/example/ui/Workspace.tsx', 1)
    drifted.set('fixture/gamma.tsx', 4)

    expect(ownershipBoundaryDifference(drifted, ALLOWLIST)).toEqual({
      unexpected: ['plugins/example/ui/Workspace.tsx'],
      stale: ['fixture/delta.tsx'],
      changed: ['fixture/gamma.tsx (allowlisted 2, found 4)'],
    })
  })

  test('uncounted guard passes when empty and names offenders in a stable order', () => {
    expectNoRawOwners([], 'select')

    const message = failureOf(() => expectNoRawOwners(['z/Late.tsx', 'a/Early.tsx'], 'select'))
    expect(message).toContain('a/Early.tsx')
    expect(message).toContain('z/Late.tsx')
    expect(message.indexOf('a/Early.tsx')).toBeLessThan(message.indexOf('z/Late.tsx'))
  })
})
