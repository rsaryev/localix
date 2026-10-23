import { describe, it, expect } from 'bun:test'
import { assignCommitLanes, MAX_LANES, type CommitLaneRow } from './commitLanes'

/** Terse commit factory: hash + parent hashes. */
function c(hash: string, parents: string[] = []): { hash: string; parents?: string[] } {
  return parents.length ? { hash, parents } : { hash }
}

/** Lane index each row's node sits in, keyed by hash — handy for assertions. */
function laneOf(rows: CommitLaneRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.hash, r.lane]))
}

describe('assignCommitLanes', () => {
  it('places a straight linear history all in lane 0', () => {
    const rows = assignCommitLanes([c('d', ['c']), c('c', ['b']), c('b', ['a']), c('a')])
    expect(rows.every((r) => r.lane === 0)).toBe(true)
    expect(rows.every((r) => r.width === 1)).toBe(true)
    // Every interior row carries a single node→parent edge (from) that is also the
    // next row's incoming continuation; the root has none.
    expect(rows[3]!.edges.length).toBe(0)
    expect(rows[0]!.edges).toEqual([{ top: 0, bottom: 0, kind: 'from' }])
  })

  it('opens a second lane for a branch-out and reserves width', () => {
    // m (merge of a1,b1) -> a1 -> b1 -> base
    const rows = assignCommitLanes([
      c('m', ['a1', 'b1']),
      c('a1', ['base']),
      c('b1', ['base']),
      c('base'),
    ])
    const lane = laneOf(rows)
    expect(lane.m).toBe(0)
    // The merge is flagged and its row reserves 2 lanes.
    const merge = rows.find((r) => r.hash === 'm')!
    expect(merge.merge).toBe(true)
    expect(merge.width).toBe(2)
    // The merge branches out to both parents (two `from` edges).
    expect(
      merge.edges
        .filter((e) => e.kind === 'from')
        .map((e) => e.bottom)
        .sort((a, b) => a - b),
    ).toEqual([0, 1])
    // a1 and b1 sit in different lanes.
    expect(lane.a1).not.toBe(lane.b1)
  })

  it('merges two lanes back together (branch-in) at the shared parent', () => {
    const rows = assignCommitLanes([
      c('m', ['a1', 'b1']),
      c('a1', ['base']),
      c('b1', ['base']),
      c('base'),
    ])
    // `base` is waited on by both a1's and b1's lanes → it draws incoming `to`
    // edges from the extra lane(s) into its node.
    const base = rows.find((r) => r.hash === 'base')!
    expect(base.edges.some((e) => e.kind === 'to')).toBe(true)
  })

  it('handles a criss-cross history without losing any node', () => {
    // Two interleaved branches feeding a merge.
    const rows = assignCommitLanes([
      c('top', ['f1', 'f2']),
      c('f1', ['mid']),
      c('f2', ['mid']),
      c('mid', ['g1', 'g2']),
      c('g1', ['root']),
      c('g2', ['root']),
      c('root'),
    ])
    expect(rows.length).toBe(7)
    // Every lane index stays within the cap.
    expect(rows.every((r) => r.width <= MAX_LANES && r.lane < MAX_LANES)).toBe(true)
    // The two merges are flagged.
    expect(
      rows
        .filter((r) => r.merge)
        .map((r) => r.hash)
        .sort(),
    ).toEqual(['mid', 'top'])
  })

  it('caps lanes and collapses overflow onto the last lane', () => {
    // One tip that is an octopus merge across far more parents than MAX_LANES.
    const parents = Array.from({ length: MAX_LANES + 5 }, (_, i) => `p${i}`)
    const commits = [c('octo', parents), ...parents.map((p) => c(p))]
    const rows = assignCommitLanes(commits)
    // No lane index or width ever exceeds the cap.
    expect(rows.every((r) => r.lane < MAX_LANES && r.width <= MAX_LANES)).toBe(true)
    expect(rows.every((r) => r.edges.every((e) => e.top < MAX_LANES && e.bottom < MAX_LANES))).toBe(
      true,
    )
  })

  it('keeps a converging branch in its own lane until the shared parent row', () => {
    // m(a1,b1) → a1(base), b1(base) → base: b1's first-parent edge must stay in
    // lane 1 (its own lane); the join into lane 0 renders on base's row as `to`.
    const rows = assignCommitLanes([
      c('m', ['a1', 'b1']),
      c('a1', ['base']),
      c('b1', ['base']),
      c('base'),
    ])
    const b1 = rows.find((r) => r.hash === 'b1')!
    expect(b1.lane).toBe(1)
    expect(b1.edges).toContainEqual({ top: 1, bottom: 1, kind: 'from' })
    expect(b1.edges.some((e) => e.kind === 'from' && e.bottom === 0)).toBe(false)
    const base = rows.find((r) => r.hash === 'base')!
    expect(base.edges).toContainEqual({ top: 1, bottom: 0, kind: 'to' })
  })

  it('narrows the rail back after a wide merge burst gives way to linear history', () => {
    // A 3-way merge fans out to three parallel tips that all rejoin at `base`,
    // then a plain linear tail. Once the branches close, width must shrink back
    // to 1 — the rail does not stay inflated after the right-most lanes free.
    const rows = assignCommitLanes([
      c('m', ['a1', 'b1', 'c1']),
      c('a1', ['base']),
      c('b1', ['base']),
      c('c1', ['base']),
      c('base', ['x1']),
      c('x1', ['x2']),
      c('x2', ['x3']),
      c('x3'),
    ])
    const w = Object.fromEntries(rows.map((r) => [r.hash, r.width]))
    // The burst reserves 3 lanes across the parallel section (incl. the merge).
    expect(w.m).toBe(3)
    expect(Math.max(w.a1!, w.b1!, w.c1!, w.base!)).toBe(3)
    // The linear tail collapses back to a single lane.
    expect(w.x1).toBe(1)
    expect(w.x2).toBe(1)
    expect(w.x3).toBe(1)
    expect(rows.every((r) => r.width <= MAX_LANES)).toBe(true)
  })

  it('reuses a freed middle lane for a later new branch (no left-drift)', () => {
    // A short-lived tip `b` occupies lane 1 then closes (no parent). A LATER merge
    // opens a second parent lane, which must reuse the freed lane 1 rather than
    // pushing out to a fresh lane 2.
    const rows = assignCommitLanes([
      c('main1', ['main2']),
      c('b'),
      c('main2', ['t', 'k']),
      c('t'),
      c('k'),
    ])
    const lane = laneOf(rows)
    expect(lane.b).toBe(1)
    // The merge's extra parent reused lane 1 — the rail never widened past 2.
    expect(lane.k).toBe(1)
    expect(rows.every((r) => r.width <= 2)).toBe(true)
  })

  it('lets an off-window parent dangle without inventing extra nodes', () => {
    // `a`'s parent `z` is never in the list (below the fetch window).
    const rows = assignCommitLanes([c('a', ['z'])])
    expect(rows.length).toBe(1)
    expect(rows[0]!.edges).toEqual([{ top: 0, bottom: 0, kind: 'from' }])
  })
})
