import { expect, test } from 'bun:test'
import { tableRowsAfter } from './table'

test('the shared table grid commits edits, inserts and deletes as one coherent matrix', () => {
  expect(
    tableRowsAfter(
      {
        title: '',
        columns: ['A', 'B'],
        rows: [
          ['one', '1'],
          ['two', '2'],
          ['three', '3'],
        ],
      },
      {
        updates: [{ row: { __spaceRow: 1 }, values: { c0: 'edited', c1: null } }],
        deletes: [{ __spaceRow: 0 }],
        inserts: [{ c0: 'new', c1: '4' }],
      },
    ),
  ).toEqual([
    ['edited', ''],
    ['three', '3'],
    ['new', '4'],
  ])
})
