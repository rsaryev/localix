import { describe, expect, it } from 'bun:test'
import type { TableColumn, TableRow } from '@localixai/dataview'
import { rowsToDocuments } from './rowsToDocuments'

const col = (id: string, title = id): TableColumn => ({ id, title, type: 'text' })

describe('rowsToDocuments', () => {
  it('re-keys by title and drops null/absent fields', () => {
    const columns = [col('_id'), col('name'), col('age')]
    const rows: TableRow[] = [
      { _id: 1, name: 'a', age: null },
      { _id: 2, name: null, age: 30 },
    ]
    expect(rowsToDocuments(columns, rows)).toEqual([
      { _id: 1, name: 'a' },
      { _id: 2, age: 30 },
    ])
  })

  it('parses JSON-string cells back into objects/arrays', () => {
    const columns = [col('tags'), col('meta')]
    const rows: TableRow[] = [{ tags: '["x","y"]', meta: '{"a":1}' }]
    expect(rowsToDocuments(columns, rows)).toEqual([{ tags: ['x', 'y'], meta: { a: 1 } }])
  })

  it('leaves plain strings and malformed JSON as-is', () => {
    const columns = [col('s'), col('bad')]
    const rows: TableRow[] = [{ s: 'hello', bad: '{oops' }]
    expect(rowsToDocuments(columns, rows)).toEqual([{ s: 'hello', bad: '{oops' }])
  })

  it('uses column title (not id) as the key', () => {
    const columns = [col('c0', 'Full Name')]
    expect(rowsToDocuments(columns, [{ c0: 'Ann' }])).toEqual([{ 'Full Name': 'Ann' }])
  })

  it('keeps __proto__ as document data without changing the reconstructed prototype', () => {
    const [doc] = rowsToDocuments(
      [col('c0', '__proto__'), col('c1', 'constructor'), col('c2', 'prototype')],
      [{ c0: '{"polluted":true}', c1: '{"safe":1}', c2: '{"safe":2}' }],
    )

    expect(Object.getPrototypeOf(doc!)).toBe(Object.prototype)
    expect(Object.hasOwn(doc!, '__proto__')).toBe(true)
    expect(doc).toEqual({
      ['__proto__']: { polluted: true },
      constructor: { safe: 1 },
      prototype: { safe: 2 },
    })
    expect(JSON.stringify(doc)).toBe(
      '{"__proto__":{"polluted":true},"constructor":{"safe":1},"prototype":{"safe":2}}',
    )
  })
})
