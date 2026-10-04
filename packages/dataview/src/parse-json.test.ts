import { describe, expect, test } from 'bun:test'

import { formatFromExtension, parseJson, parseTable, tableFromJson } from './parse'

/**
 * Behavior lock for the JSON→table import path (parseDelimited/inferType are covered in
 * dataview.test.ts; this path was not). Pins the three accepted shapes, nested-value
 * stringification, primitive rows, column inference/union, and format dispatch.
 */
describe('parseJson', () => {
  test('an array of objects → a row per object, nested values JSON-stringified', () => {
    expect(parseJson('[{"a":1,"b":{"x":2}}]')).toEqual({ rows: [{ a: 1, b: '{"x":2}' }] })
  })

  test('an array of primitives → { value } rows', () => {
    expect(parseJson('[1,"two",true]')).toEqual({
      rows: [{ value: 1 }, { value: 'two' }, { value: true }],
    })
  })

  test('a { rows, columns } envelope passes columns through', () => {
    const cols = [{ id: 'a', title: 'A', type: 'int' as const }]
    expect(parseJson('{"columns":[{"id":"a","title":"A","type":"int"}],"rows":[{"a":1}]}')).toEqual(
      {
        columns: cols,
        rows: [{ a: 1 }],
      },
    )
  })

  test('an unsupported shape throws', () => {
    expect(() => parseJson('42')).toThrow(/Unsupported JSON shape/)
    expect(() => parseJson('{"foo":1}')).toThrow(/Unsupported JSON shape/)
  })
})

describe('tableFromJson', () => {
  test('infers a UNION of keys across rows and null-fills the gaps', () => {
    const t = tableFromJson('[{"a":1},{"a":2,"b":3}]')
    expect(t.columns.map((c) => c.id)).toEqual(['a', 'b'])
    expect(t.rows).toEqual([
      { a: 1, b: null },
      { a: 2, b: 3 },
    ])
  })

  test('uses provided columns when the envelope supplies them', () => {
    const t = tableFromJson(
      '{"columns":[{"id":"a","title":"A","type":"int"}],"rows":[{"a":1,"b":9}]}',
    )
    expect(t.columns.map((c) => c.id)).toEqual(['a']) // b dropped — not a declared column
    expect(t.rows).toEqual([{ a: 1 }])
  })
})

describe('formatFromExtension', () => {
  test('maps known extensions (case-insensitively) and undefined otherwise', () => {
    expect(formatFromExtension('data.csv')).toBe('csv')
    expect(formatFromExtension('data.CSV')).toBe('csv')
    expect(formatFromExtension('data.tsv')).toBe('tsv')
    expect(formatFromExtension('data.tab')).toBe('tsv')
    expect(formatFromExtension('data.json')).toBe('json')
    expect(formatFromExtension('data.xlsx')).toBeUndefined()
  })
})

describe('parseTable dispatch', () => {
  test('json vs csv vs tsv route to the right parser', () => {
    expect(parseTable('[{"a":1}]', 'json').rows).toEqual([{ a: 1 }])
    expect(parseTable('a,b\n1,2', 'csv').rows[0]).toMatchObject({})
    const tsv = parseTable('a\tb\n1\t2', 'tsv')
    expect(tsv.columns.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
