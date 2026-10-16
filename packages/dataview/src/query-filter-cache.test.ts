import { describe, expect, test } from 'bun:test'
import { tableFromJson } from './parse'
import { filterRows } from './query'

describe('filterRows text cache', () => {
  test('repeated keystrokes over the same rows keep matching case-insensitively', () => {
    const rows = [
      { name: 'Alpha', n: 12 },
      { name: 'beta', n: null },
    ]
    expect(filterRows(rows, { query: 'AL' })).toEqual([rows[0]!])
    expect(filterRows(rows, { query: 'alp' })).toEqual([rows[0]!])
    expect(filterRows(rows, { query: '12', columnId: 'n' })).toEqual([rows[0]!])
    expect(filterRows(rows, { query: 'BET', columnId: 'name' })).toEqual([rows[1]!])
  })

  test('new row objects are matched on their own values', () => {
    expect(filterRows([{ name: 'gamma' }], { query: 'alpha' })).toEqual([])
  })
})

describe('tableFromJson', () => {
  test('fills missing columns and drops keys outside an explicit schema', () => {
    const text = JSON.stringify({
      columns: [{ id: 'a', name: 'a', type: 'text' }],
      rows: [{ a: 'x', extra: 1 }, {}],
    })
    expect(tableFromJson(text).rows).toEqual([{ a: 'x' }, { a: null }])
  })
})
