import { expect, test } from 'bun:test'

import { tableFromMatrix } from './table-shape'

test('blank header cells are named by their own position', () => {
  // `indexOf` found the FIRST blank, so every unnamed column after it was "Column 1" too.
  const { columns } = tableFromMatrix([
    ['name', null, 'age', null, '', ''],
    ['Ada', 1, 36, 2, 3, 4],
  ])
  expect(columns.map((column) => column.title)).toEqual([
    'name',
    'Column 2',
    'age',
    'Column 4',
    'Column 5',
    'Column 6',
  ])
})

test('without a header every column is positional, and maxRows caps rows but not total', () => {
  const shaped = tableFromMatrix(
    [
      ['a', 1],
      ['b', 2],
      [null, ''],
      ['c', 3],
    ],
    { header: false, maxRows: 2 },
  )
  expect(shaped.columns.map((column) => column.title)).toEqual(['Column 1', 'Column 2'])
  expect(shaped.total).toBe(3)
  expect(shaped.rows).toHaveLength(2)
})
