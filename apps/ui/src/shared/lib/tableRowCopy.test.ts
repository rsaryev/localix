import { describe, expect, it } from 'bun:test'
import type { TableColumn, TableRow } from '@localixai/dataview'
import { cellToText, rowToJson } from './tableRowCopy'

const columns: TableColumn[] = [
  { id: 'c0', title: 'id', type: 'int' },
  { id: 'c1', title: 'name', type: 'text' },
  { id: 'c2', title: 'active', type: 'bool' },
]

describe('rowToJson', () => {
  it('keys by column title and preserves raw value types', () => {
    const row: TableRow = { c0: 7, c1: 'Ada', c2: true }
    expect(rowToJson(columns, row)).toBe(
      JSON.stringify({ id: 7, name: 'Ada', active: true }, null, 2),
    )
  })

  it('renders null cells as null and includes a column missing from the row', () => {
    const row: TableRow = { c0: 1, c1: null } // c2 absent
    expect(JSON.parse(rowToJson(columns, row))).toEqual({ id: 1, name: null, active: null })
  })

  it('keeps falsy-but-present values (0, empty string, false)', () => {
    const row: TableRow = { c0: 0, c1: '', c2: false }
    expect(JSON.parse(rowToJson(columns, row))).toEqual({ id: 0, name: '', active: false })
  })
})

describe('cellToText', () => {
  const row: TableRow = { c0: 42, c1: 'hi', c2: false, c3: null }

  it('renders via formatCell — numbers, strings, booleans, null', () => {
    expect(cellToText(row, 'c0')).toBe('42')
    expect(cellToText(row, 'c1')).toBe('hi')
    expect(cellToText(row, 'c2')).toBe('false')
    expect(cellToText(row, 'c3')).toBe('')
  })

  it('renders a missing column as empty string', () => {
    expect(cellToText(row, 'nope')).toBe('')
  })
})
