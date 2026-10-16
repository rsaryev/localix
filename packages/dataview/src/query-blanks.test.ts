import { describe, expect, test } from 'bun:test'

import type { TableCellValue, TableColumn, TableRow } from './model'
import { sortRows } from './query'

/**
 * `compareValues` states the rule as "nulls last", and it held — ascending. The
 * verdict was then multiplied by the sort direction along with everything else, so
 * reversing the sort floated every blank cell to the TOP, pushing the data the user
 * had just asked to rank out of view. The same applied to a non-numeric cell in a
 * numeric column, which `Number()` turns into NaN and the comparator ranks the same
 * way as a null.
 *
 * A blank is not a value. It has no place in the ordering of values, so it sinks
 * whichever way the ordering runs — which is what the comment always claimed.
 */

const numeric: TableColumn[] = [{ id: 'n', title: 'N', type: 'number' }]
const text: TableColumn[] = [{ id: 's', title: 'S', type: 'text' }]

// The return type says `| undefined` on purpose: `TableCellValue` has no undefined,
// but a lookup on a row missing that key produces one, and that is a case under test.
const order = (
  rows: TableRow[],
  dir: 'asc' | 'desc',
  columns: TableColumn[],
  id: string,
): Array<TableCellValue | undefined> =>
  sortRows(rows, { columnId: id, dir }, columns).map((r) => r[id])

describe('blanks sink in both directions', () => {
  // `TableCellValue` has no `undefined`, but a row that simply LACKS the key yields
  // one at lookup — a sparse row from a producer that did not null-fill. Both forms
  // of "no value" must behave the same, so the fixture carries one of each.
  const withNulls: TableRow[] = [{ n: 3 }, { n: null }, { n: 1 }, {}, { n: 2 }]

  test('numeric ascending puts values first, blanks last', () => {
    expect(order(withNulls, 'asc', numeric, 'n')).toEqual([1, 2, 3, null, undefined])
  })

  test('numeric descending reverses the VALUES and leaves the blanks at the bottom', () => {
    expect(order(withNulls, 'desc', numeric, 'n')).toEqual([3, 2, 1, null, undefined])
  })

  test('text descending does not float empty cells to the top', () => {
    const rows: TableRow[] = [{ s: 'b' }, { s: null }, { s: 'a' }]
    expect(order(rows, 'desc', text, 's')).toEqual(['b', 'a', null])
  })

  test('a non-numeric cell in a numeric column is a blank, not a value', () => {
    // `Number('n/a')` is NaN. Ranked among the numbers it would be arbitrary; ranked
    // as a blank it is at least predictable, and it must not lead the descending sort.
    const rows: TableRow[] = [{ n: 2 }, { n: 'n/a' }, { n: 10 }]
    expect(order(rows, 'desc', numeric, 'n')).toEqual([10, 2, 'n/a'])
    expect(order(rows, 'asc', numeric, 'n')).toEqual([2, 10, 'n/a'])
  })

  test('blanks keep their original order relative to each other', () => {
    // The sort is documented as stable; that has to survive for equal-rank blanks
    // too, or a re-sort would shuffle rows the user did not ask to move.
    const rows: TableRow[] = [{ n: null, tag: 'first' }, { n: 5, tag: 'value' }, { tag: 'second' }]
    const tags = sortRows(rows, { columnId: 'n', dir: 'desc' }, numeric).map((r) => r.tag)
    expect(tags).toEqual(['value', 'first', 'second'])
  })
})
