import { describe, expect, it } from 'bun:test'
import {
  clearHistory,
  promoteHistory,
  restoreHistory,
  sortHistory,
  SQL_HISTORY_CAP,
  togglePin,
  type SqlHistoryEntry,
} from './sqlHistory'

const e = (sql: string, at = 0): SqlHistoryEntry => ({ sql, at })

describe('promoteHistory', () => {
  it('adds a new entry at the front', () => {
    const out = promoteHistory([e('SELECT 1')], e('SELECT 2', 5))
    expect(out.map((x) => x.sql)).toEqual(['SELECT 2', 'SELECT 1'])
  })

  it('dedupes by SQL text, floating the repeat to the front', () => {
    const out = promoteHistory([e('a'), e('b'), e('c')], e('c', 9))
    expect(out.map((x) => x.sql)).toEqual(['c', 'a', 'b'])
    expect(out[0].at).toBe(9)
  })

  it('trims and ignores blank SQL', () => {
    expect(promoteHistory([e('a')], e('   '))).toEqual([e('a')])
    expect(promoteHistory([], e('  SELECT 1  ', 3))).toEqual([{ sql: 'SELECT 1', at: 3 }])
  })

  it('caps the list length', () => {
    let list: SqlHistoryEntry[] = []
    for (let i = 0; i < SQL_HISTORY_CAP + 10; i++) list = promoteHistory(list, e(`q${i}`, i))
    expect(list).toHaveLength(SQL_HISTORY_CAP)
    expect(list[0].sql).toBe(`q${SQL_HISTORY_CAP + 9}`)
  })

  it('keeps a re-run query pinned state', () => {
    const pinned = togglePin([e('a', 1)], 'a')
    const out = promoteHistory(pinned, e('a', 9))
    expect(out[0].pinned).toBe(true)
    expect(out[0].at).toBe(9)
  })

  it('never evicts pinned favorites past the cap', () => {
    let list = togglePin([e('keep', 0)], 'keep')
    for (let i = 0; i < SQL_HISTORY_CAP + 10; i++) list = promoteHistory(list, e(`q${i}`, i + 1))
    expect(list).toHaveLength(SQL_HISTORY_CAP)
    expect(list.some((x) => x.sql === 'keep' && x.pinned)).toBe(true)
  })
})

describe('togglePin / clearHistory / sortHistory', () => {
  it('toggles the pinned flag on the matching entry', () => {
    const out = togglePin([e('a'), e('b')], 'a')
    expect(out.find((x) => x.sql === 'a')?.pinned).toBe(true)
    expect(togglePin(out, 'a').find((x) => x.sql === 'a')?.pinned).toBe(false)
  })

  it('clear keeps only pinned favorites', () => {
    const list = togglePin([e('a'), e('b')], 'b')
    expect(clearHistory(list).map((x) => x.sql)).toEqual(['b'])
  })

  it('sorts pinned first, then by recency', () => {
    const list: SqlHistoryEntry[] = [
      { sql: 'new', at: 10 },
      { sql: 'old-pin', at: 1, pinned: true },
      { sql: 'mid', at: 5 },
    ]
    expect(sortHistory(list).map((x) => x.sql)).toEqual(['old-pin', 'new', 'mid'])
  })
})

describe('restoreHistory — the undo half of a clear', () => {
  it('brings back exactly what the clear removed', () => {
    const before = [
      { sql: 'select 1', at: 30 },
      { sql: 'select 2', at: 20, pinned: true },
      { sql: 'select 3', at: 10 },
    ]
    const cleared = clearHistory(before)
    expect(cleared).toEqual([{ sql: 'select 2', at: 20, pinned: true }])
    expect(restoreHistory(cleared, before).map((e) => e.sql)).toEqual([
      'select 2',
      'select 1',
      'select 3',
    ])
  })

  it('keeps a query recorded AFTER the clear — an undo must not lose newer work', () => {
    const before = [{ sql: 'select 1', at: 10 }]
    const afterClear = promoteHistory(clearHistory(before), { sql: 'select new', at: 50 })
    const restored = restoreHistory(afterClear, before)
    expect(restored.map((e) => e.sql).sort()).toEqual(['select 1', 'select new'])
    // Recency order is preserved: the newer statement stays in front.
    expect(restored[0]!.sql).toBe('select new')
  })

  it('does not revert a pin toggled after the clear', () => {
    const before = [{ sql: 'select 1', at: 10, pinned: true }]
    // Unpinned after the clear (so it is gone), then pinned again by hand on a re-run.
    const afterClear = togglePin(promoteHistory([], { sql: 'select 1', at: 60 }), 'select 1')
    expect(afterClear[0]!.pinned).toBe(true)
    const restored = restoreHistory(afterClear, before)
    expect(restored).toHaveLength(1)
    // The LIVE entry wins on every field — including its timestamp.
    expect(restored[0]!.at).toBe(60)
    expect(restored[0]!.pinned).toBe(true)
  })

  it('carries a snapshot pin that the live list no longer has', () => {
    // promoteHistory inherits `pinned` from the EXISTING entry, which for a restored statement
    // is none — the snapshot's own flag has to be re-applied or an undo silently unpins.
    const before = [{ sql: 'select 1', at: 10, pinned: true }]
    const restored = restoreHistory([], before)
    expect(restored[0]).toMatchObject({ sql: 'select 1', pinned: true })
  })

  it('respects the cap, so an undo cannot produce an over-long list', () => {
    const snapshot = Array.from({ length: SQL_HISTORY_CAP + 20 }, (_, i) => ({
      sql: `select ${i}`,
      at: i,
    }))
    expect(restoreHistory([], snapshot)).toHaveLength(SQL_HISTORY_CAP)
  })

  it('is a no-op when nothing is missing', () => {
    const list = [{ sql: 'select 1', at: 10 }]
    expect(restoreHistory(list, list)).toEqual(list)
  })
})
