import { describe, expect, test } from 'bun:test'

import { toCsv } from './export/csv'
import type { TableColumn, TableRow } from './model'
import { parseDelimited } from './parse'

/**
 * `parseDelimited` had no direct test — the suite covered JSON parsing, format
 * dispatch and CSV EXPORT (RFC-4180 escaping), but never the read side. Escaping
 * correctly on write and unescaping correctly on read are two different claims, and
 * only one of them was checked.
 */

const grid = (header: string[], ...rows: string[][]) => [header, ...rows]

/** Round-trip a grid through our own exporter and back. */
function roundTrip(cells: string[][]): string[][] {
  const [header = [], ...rows] = cells
  const columns: TableColumn[] = header.map((title, i) => ({
    id: `c${i}`,
    title,
    type: 'text',
  }))
  const rowObjects: TableRow[] = rows.map((row) =>
    Object.fromEntries(row.map((value, i) => [`c${i}`, value])),
  )
  return parseDelimited(toCsv(columns, rowObjects))
}

describe('parseDelimited', () => {
  test('a quoted EMPTY final field is a field, not the absence of one', () => {
    // Any spreadsheet can produce this: one column, last cell empty, written with
    // explicit quoting and no trailing newline. The row was silently dropped.
    expect(parseDelimited('note\r\n""')).toEqual([['note'], ['']])
  })

  test('the same input with a trailing newline already worked — the loss depended on it', () => {
    expect(parseDelimited('note\r\n""\r\n')).toEqual([['note'], ['']])
  })

  test('a trailing terminator still does not invent a phantom row', () => {
    // The other half of the rule: a line terminator ENDS the last record, it does
    // not begin another. Fixing the case above must not break this one.
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseDelimited('a\nb\n')).toEqual([['a'], ['b']])
  })

  test('quotes, embedded delimiters and newlines survive', () => {
    expect(parseDelimited('a,b\r\n"x,y","he said ""hi""\nbye"')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"\nbye'],
    ])
  })

  test('a BOM is stripped and CR / CRLF / LF all terminate a record', () => {
    expect(parseDelimited('﻿a\r\n1\n2\r3')).toEqual([['a'], ['1'], ['2'], ['3']])
  })
})

describe('CSV survives its own round trip', () => {
  test('a single column whose last value is empty keeps that row', () => {
    // An empty last row serialized to an empty LINE, which is indistinguishable
    // from the terminator of the line before it — so the row vanished on re-read.
    const cells = grid(['note'], ['a'], [''])
    expect(roundTrip(cells)).toEqual(cells)
  })

  test('a single column whose only value is empty keeps that row', () => {
    const cells = grid(['note'], [''])
    expect(roundTrip(cells)).toEqual(cells)
  })

  test('values needing escapes round-trip unchanged', () => {
    const cells = grid(['a', 'b'], ['x,y', 'he said "hi"\nbye'], ['  ', '"'])
    expect(roundTrip(cells)).toEqual(cells)
  })

  test('multi-column empty rows were never affected, and still are not', () => {
    const cells = grid(['a', 'b'], ['1', '2'], ['', ''])
    expect(roundTrip(cells)).toEqual(cells)
  })
})
