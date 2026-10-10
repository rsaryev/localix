import { expect, test } from 'bun:test'

import type { TableCellValue, TableColumn, TableRow } from './model'
import { filterRows, sortRows } from './query'

test('numeric sorting preserves coercion, tie order, row identity and the original array', () => {
  const rows: TableRow[] = [
    { n: true, tag: 'one' },
    { n: false, tag: 'false' },
    { n: '', tag: 'empty' },
    { n: '  ', tag: 'space' },
    { n: '0x10', tag: 'hex' },
    { n: null, tag: 'null' },
    { n: 'invalid', tag: 'invalid' },
  ]
  for (const row of rows) Object.freeze(row)
  const original = [...rows]
  const columns: TableColumn[] = [{ id: 'n', title: 'N', type: 'number' }]
  const ascending = sortRows(rows, { columnId: 'n', dir: 'asc' }, columns)
  expect(ascending.map((row) => row.tag)).toEqual([
    'false',
    'empty',
    'space',
    'one',
    'hex',
    'null',
    'invalid',
  ])
  expect(sortRows(rows, { columnId: 'n', dir: 'desc' }, columns).map((row) => row.tag)).toEqual([
    'hex',
    'one',
    'false',
    'empty',
    'space',
    'null',
    'invalid',
  ])
  expect(ascending[0]).toBe(rows[1])
  expect(rows).toEqual(original)
})

test('scoped and global filters share case-insensitive matching of displayed cell values', () => {
  const rows: TableRow[] = [
    { name: 'Ada', active: true },
    { name: 'Grace', active: false },
    { name: 'true', active: null },
  ]
  expect(filterRows(rows, { query: ' TRUE ' })).toEqual([rows[0]!, rows[2]!])
  expect(filterRows(rows, { columnId: 'active', query: ' TRUE ' })).toEqual([rows[0]!])
  expect(filterRows(rows, { columnId: 'missing', query: 'true' })).toEqual([])
  expect(filterRows(rows, { query: '  ' })).toBe(rows)
  expect(filterRows(rows, undefined)).toBe(rows)
})

test('filtering retains runtime object and binary formatting from data drivers', () => {
  const object = { label: 'Needle' } as unknown as TableCellValue
  const binary = new Uint8Array([0xde, 0xad]) as unknown as TableCellValue
  const rows: TableRow[] = [{ value: object }, { value: binary }, { value: null }]
  expect(filterRows(rows, { query: 'NEEDLE' })).toEqual([rows[0]!])
  expect(filterRows(rows, { columnId: 'value', query: '\\xdead' })).toEqual([rows[1]!])
})
