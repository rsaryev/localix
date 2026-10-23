import { describe, expect, test } from 'bun:test'

import type { DbResultSet } from '../dbClient'
import { adaptResult, adaptedRowsForTextExport, adaptedRowsToRecords } from './resultAdapter'

/**
 * Behavior lock for the SQL-result → dataview grid adapter — the bridge every query result
 * renders through. Pins the parts a regression would silently break: unique column ids when
 * a query yields duplicate/blank labels (a collision would drop columns in the keyed rows),
 * type inference over every non-null cell, and the `coerce` special cases
 * (Buffer/Uint8Array/Date/bigint/object) that keep an odd cell from crashing the grid.
 */
const rs = (names: string[], rows: unknown[][]): DbResultSet => ({
  columns: names.map((name) => ({ name })),
  rows,
  durationMs: 0,
})

describe('adaptResult — column ids', () => {
  test('duplicate and blank labels get unique ids; titles keep the original name', () => {
    const out = adaptResult(rs(['id', 'id', ''], [[1, 2, 3]]))
    expect(out.columns.map((c) => c.id)).toEqual(['id', 'id_1', 'col_2'])
    expect(out.columns.map((c) => c.title)).toEqual(['id', 'id', 'col_2'])
    // Every cell is reachable under its unique id (a collision would clobber one).
    expect(out.rows[0]).toEqual({ id: 1, id_1: 2, col_2: 3 })
  })

  test('JSON records use those unique ids instead of collapsing duplicate labels', () => {
    const out = adaptResult(
      rs(
        ['id', 'id', ''],
        [
          [1, 2, 'a'],
          [3, 4, null],
        ],
      ),
    )
    expect(adaptedRowsToRecords(out, out.rows)).toEqual([
      { id: 1, id_1: 2, col_2: 'a' },
      { id: 3, id_1: 4, col_2: null },
    ])
  })

  test('prototype-named labels remain own grid and raw-value keys', () => {
    const exact = { nested: true }
    const out = adaptResult(rs(['__proto__', 'constructor', 'prototype'], [[exact, 2, 3]]))
    const row = out.rows[0]!

    expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
    expect(Object.hasOwn(row, '__proto__')).toBe(true)
    expect(row.__proto__).toBe('{"nested":true}')
    expect(adaptedRowsToRecords(out, [row])).toEqual([
      {
        ['__proto__']: exact,
        constructor: 2,
        prototype: 3,
      },
    ])
  })
})

describe('adaptResult — type inference over every non-null cell', () => {
  test('int / float / bool / text', () => {
    const out = adaptResult(
      rs(
        ['a', 'b', 'c', 'd'],
        [
          [null, 3.5, true, 'x'],
          [7, null, null, null],
        ],
      ),
    )
    expect(out.columns.map((c) => c.type)).toEqual(['int', 'float', 'bool', 'text'])
  })

  test('a column whose later cells disagree is not typed by its first', () => {
    const out = adaptResult(
      rs(
        ['mixed', 'widened'],
        [
          [1, 1],
          ['n/a', 1.5],
          [2, 3],
        ],
      ),
    )
    expect(out.columns.map((c) => c.type)).toEqual(['text', 'float'])
  })

  test('an all-null column falls back to text', () => {
    expect(adaptResult(rs(['x'], [[null]])).columns[0]!.type).toBe('text')
  })
})

describe('adaptResult — coerce keeps odd cells renderable', () => {
  test('primitives pass through, null stays null', () => {
    const row = adaptResult(rs(['s', 'n', 'b', 'z'], [['hi', 4, false, null]])).rows[0]!
    expect(row).toEqual({ s: 'hi', n: 4, b: false, z: null })
  })

  test('Date → ISO, bigint → exact JSON primitive, object → JSON, blobs → compact marker', () => {
    const out = adaptResult(
      rs(
        ['dt', 'big', 'wide', 'obj', 'u8', 'nodebuf'],
        [
          [
            new Date('2026-01-02T03:04:05.000Z'),
            10n,
            9007199254740993n,
            { a: 1 },
            new Uint8Array([1, 2, 3]),
            { type: 'Buffer', data: [9, 9] },
          ],
        ],
      ),
    )
    const row = out.rows[0]!
    expect(row.dt).toBe('2026-01-02T03:04:05.000Z')
    expect(row.big).toBe(10)
    expect(row.wide).toBe('9007199254740993')
    expect(row.obj).toBe('{"a":1}')
    expect(row.u8).toBe('[blob 3B]')
    expect(row.nodebuf).toBe('[blob 2B]')

    // Display values stay compact, while exports recover the exact bytes from the sidecar.
    expect(adaptedRowsToRecords(out, [row])[0]).toMatchObject({
      u8: new Uint8Array([1, 2, 3]),
      nodebuf: { type: 'Buffer', data: [9, 9] },
    })
    expect(adaptedRowsForTextExport(out, [row])[0]).toMatchObject({
      u8: '\\x010203',
      nodebuf: '\\x0909',
    })
  })

  test('exact values follow row identity through sorting/filtering order', () => {
    const out = adaptResult(
      rs(
        ['id', 'payload'],
        [
          [2, { type: 'Buffer', data: [2] }],
          [1, { type: 'Buffer', data: [1] }],
        ],
      ),
    )
    expect(adaptedRowsForTextExport(out, [out.rows[1]!, out.rows[0]!])).toEqual([
      { id: 1, payload: '\\x01' },
      { id: 2, payload: '\\x02' },
    ])
  })

  test('renders nested bigint JSON without replacing the whole cell with an error marker', () => {
    const row = adaptResult(rs(['payload'], [[{ safe: 42n, wide: 9007199254740993n }]])).rows[0]!
    expect(row.payload).toBe('{"safe":42,"wide":"9007199254740993"}')
  })
})

describe('adaptResult — empty', () => {
  test('no columns → empty adaptation', () => {
    const out = adaptResult(rs([], []))
    expect(out.columns).toEqual([])
    expect(out.rows).toEqual([])
    expect(out.rawValues).toBeInstanceOf(WeakMap)
  })
})
