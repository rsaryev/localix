import { expect } from 'bun:test'

/**
 * Ownership guards walk the filesystem, so the order they discover offenders in
 * changes whenever a file is added or renamed. Comparing the walk result to the
 * allowlist directly still *passes* correctly — but the failure it prints is a
 * positional diff in which unchanged entries show up as both added and removed,
 * burying the one line that matters.
 *
 * These helpers keep the guard exactly as strict and split the failure into the
 * three things a developer actually needs named: what is new, what is stale, and
 * what changed count.
 */

export interface OwnershipBoundaryDifference {
  /** Files that match the raw pattern but are not on the allowlist. */
  unexpected: string[]
  /** Allowlisted files that no longer match — the rule they claim is gone. */
  stale: string[]
  /** Allowlisted files whose occurrence count moved. */
  changed: string[]
}

/** The full content difference between a walk result and its allowlist. */
export function ownershipBoundaryDifference(
  actual: ReadonlyMap<string, number>,
  allowlist: ReadonlyMap<string, number>,
): OwnershipBoundaryDifference {
  const unexpected: string[] = []
  const changed: string[] = []

  for (const [path, count] of actual) {
    const allowed = allowlist.get(path)
    if (allowed === undefined) {
      unexpected.push(path)
    } else if (allowed !== count) {
      changed.push(`${path} (allowlisted ${allowed}, found ${count})`)
    }
  }

  const stale = [...allowlist.keys()].filter((path) => !actual.has(path))

  return { unexpected: unexpected.sort(), stale: stale.sort(), changed: changed.sort() }
}

/**
 * Assert a counted walk matches its allowlist exactly. Covers every way the two
 * can differ — a new offender, a stale entry, or a moved count — so it is the
 * same assertion as comparing the maps outright, only order-independent and
 * legible when it fails.
 */
export function expectOwnershipBoundary(
  actual: ReadonlyMap<string, number>,
  allowlist: ReadonlyMap<string, number>,
  primitive: string,
): void {
  const { unexpected, stale, changed } = ownershipBoundaryDifference(actual, allowlist)

  expect(
    unexpected,
    `new raw <${primitive}> owners: route them through the shared primitive, or allowlist them deliberately with a reason`,
  ).toEqual([])
  expect(
    stale,
    `stale <${primitive}> allowlist entries: these files no longer contain a raw <${primitive}>, so drop them from the allowlist`,
  ).toEqual([])
  expect(
    changed,
    `<${primitive}> occurrence counts moved: confirm the new usage is still the owning mechanic, then update the count`,
  ).toEqual([])
}

/**
 * Assert an uncounted walk found nothing. Sorted so the printed offender list is
 * stable across filesystem walk order.
 */
export function expectNoRawOwners(offenders: readonly string[], primitive: string): void {
  expect(
    [...offenders].sort(),
    `raw <${primitive}> usages: route these through the shared primitive`,
  ).toEqual([])
}
