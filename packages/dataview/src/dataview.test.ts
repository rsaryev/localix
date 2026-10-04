import { test, expect, describe } from 'bun:test'

import { csvEscape, toCsv } from './export/csv'
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS } from './export/registry'
import { XLSX_MIME, xlsxExporter } from './export/xlsx'
import { createDefaultExporterRegistry, getOpenTarget, OPEN_TARGETS } from './index'
import { inferType, parseDelimited, parseTable, tableFromDelimited, tableFromJson } from './parse'
import { filterRows, pageRows, sortRows } from './query'
import { summarizeTable, summaryToText } from './summarize'
import { defaultChartSpec, validateChartSpec } from './chart'
import { formatCell } from './model'
import type { TableColumn, TableModel, TableRow } from './model'

const cols: TableColumn[] = [
  { id: 'name', title: 'Name', type: 'text' },
  { id: 'age', title: 'Age', type: 'int' },
  { id: 'score', title: 'Score', type: 'float' },
]

describe('csv export (RFC-4180)', () => {
  test('escapes delimiter, quote, newline', () => {
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('quote"d')).toBe('"quote""d"')
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })

  test('toCsv builds header + CRLF rows', () => {
    const out = toCsv(
      [
        { id: 'a', title: 'A', type: 'text' },
        { id: 'b', title: 'B', type: 'int' },
      ],
      [
        { a: 'x,y', b: 1 },
        { a: 'q"d', b: 2 },
      ],
    )
    expect(out).toBe('A,B\r\n"x,y",1\r\n"q""d",2')
  })

  test('default registry has csv', () => {
    const reg = createDefaultExporterRegistry()
    expect(reg.has('csv')).toBe(true)
    expect(reg.list().map((e) => e.id)).toContain('csv')
  })
})

describe('xlsx export declaration', () => {
  test('default registry declares xlsx (metadata only)', () => {
    const reg = createDefaultExporterRegistry()
    expect(reg.has('xlsx')).toBe(true)
    const x = reg.get('xlsx')!
    expect(x.label).toBe('Excel (XLSX)')
    expect(x.extension).toBe('xlsx')
    expect(x.mimeType).toBe(XLSX_MIME)
  })

  test('serialize throws — byte encoding is host-side (SheetJS), never client-side', () => {
    expect(() =>
      xlsxExporter.serialize([{ id: 'a', title: 'A', type: 'text' }], [{ a: 'x' }]),
    ).toThrow(/host/i)
  })

  test('spreadsheet open-targets prefer the xlsx exporter over lossy csv', () => {
    for (const id of ['numbers', 'excel', 'libreoffice']) {
      expect(getOpenTarget(id)?.exporterId).toBe('xlsx')
    }
    // System-default / reveal stay csv (opens anywhere, no lib needed).
    expect(getOpenTarget('system-default')?.exporterId).toBe('csv')
    // Every target still names a format the default registry can resolve.
    const reg = createDefaultExporterRegistry()
    for (const t of OPEN_TARGETS) expect(reg.has(t.exporterId)).toBe(true)
  })
})

/**
 * The format id is the ONLY thing binding three parties: the exporter that declares it,
 * the open-target that requests it, and the HOST that registers a real serializer over
 * dataview's throwing `xlsx` stub. The registry is a plain `Map<string, …>` — a host that
 * mistypes the id registers a SECOND entry and leaves the stub sitting at `xlsx`, so
 * "Open in Excel" throws at export time having type-checked clean.
 *
 * So the ids are declared once (`EXPORT_FORMATS`) and pinned here against the LITERALS
 * the host must match. A rename shows up as a failure with the old string in the diff,
 * not as a broken export button.
 */
describe('export-format vocabulary: the id the host must match', () => {
  test('EXPORT_FORMATS is the literal wire vocabulary', () => {
    expect(EXPORT_FORMATS).toEqual({ csv: 'csv', xlsx: 'xlsx' })
    expect(DEFAULT_EXPORT_FORMAT).toBe('csv')
  })

  test('every declared exporter and every open-target names a format from the vocabulary', () => {
    const vocabulary = new Set<string>(Object.values(EXPORT_FORMATS))
    for (const e of createDefaultExporterRegistry().list()) expect(vocabulary.has(e.id)).toBe(true)
    for (const t of OPEN_TARGETS) expect(vocabulary.has(t.exporterId)).toBe(true)
  })
})

describe('parse + infer', () => {
  test('parseDelimited handles quotes/escapes', () => {
    expect(parseDelimited('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseDelimited('"x,y",1')).toEqual([['x,y', '1']])
    expect(parseDelimited('"a""b",2')).toEqual([['a"b', '2']])
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('inferType', () => {
    expect(inferType(['1', '2', '3'])).toBe('int')
    expect(inferType(['1.5', '2', '3'])).toBe('float')
    expect(inferType(['true', 'false'])).toBe('bool')
    expect(inferType(['2020-01-01', '2021-06-15'])).toBe('date')
    expect(inferType(['a', 'b'])).toBe('text')
    expect(inferType(['1', 'x'])).toBe('text')
  })

  test('tableFromDelimited builds typed rows', () => {
    const t = tableFromDelimited('name,age\nAda,36\nBob,40')
    expect(t.columns.map((c) => [c.id, c.type])).toEqual([
      ['name', 'text'],
      ['age', 'int'],
    ])
    expect(t.rows).toEqual([
      { name: 'Ada', age: 36 },
      { name: 'Bob', age: 40 },
    ])
  })

  test('tableFromJson infers from objects', () => {
    const t = tableFromJson('[{"a":1,"b":"x"},{"a":2,"b":"y"}]')
    expect(t.columns.map((c) => [c.id, c.type])).toEqual([
      ['a', 'int'],
      ['b', 'text'],
    ])
    expect(t.rows).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ])
  })
})

/**
 * THE TWO HALVES OF ONE CONTRACT, TESTED TOGETHER.
 *
 * `csvEscape` had its own test and `parseDelimited` had its own; nothing asserted that what the
 * exporter WRITES the parser READS BACK. Measured on adversarial cells, and it did not: a two-column
 * table whose only row was `{a:'', b:''}` exported to `a,b\r\n,` and came back as ZERO rows —
 * silent data loss in a user's exported file, from a filter that dropped any row whose cells were all
 * empty.
 *
 * Row COUNT and cell TEXT are the contract, not deep equality: re-reading a CSV re-infers types, so
 * `'2'` legitimately returns as the number 2.
 */
describe('csv export → parse round-trip', () => {
  const rt = (columns: TableColumn[], rows: TableRow[]) => parseTable(toCsv(columns, rows), 'csv')
  const textCols = (...ids: string[]): TableColumn[] =>
    ids.map((id) => ({ id, title: id, type: 'text' as const }))

  test('a row of empty cells survives — it is data, not a blank line', () => {
    expect(rt(textCols('a', 'b'), [{ a: '', b: '' }]).rows).toHaveLength(1)
    expect(
      rt(textCols('a', 'b'), [
        { a: 'x', b: 'y' },
        { a: '', b: '' },
      ]).rows,
    ).toHaveLength(2)
    // …and a partially empty row keeps the value it does have.
    expect(rt(textCols('a', 'b'), [{ a: '', b: 'y' }]).rows[0]).toEqual({ a: null, b: 'y' })
  })

  test('a trailing newline still yields no row', () => {
    // The other half of the same rule: one empty field IS a blank line. This is also why a
    // one-column table whose last value is empty cannot round-trip — `a\r\n` is indistinguishable
    // from a trailing newline in CSV, and every parser resolves it as no row.
    expect(parseTable('a,b\r\n1,2\r\n', 'csv').rows).toHaveLength(1)
    expect(parseTable('a\r\n', 'csv').rows).toHaveLength(0)
  })

  test('quotes, delimiters and embedded newlines come back byte-for-byte', () => {
    const nasty = [
      { a: 'say "hi", ok' },
      { a: 'line1\r\nline2' },
      { a: 'trailing space ' },
      { a: '"' },
      { a: ',' },
    ]
    const back = rt(textCols('a'), nasty)
    expect(back.rows).toHaveLength(nasty.length)
    expect(back.rows.map((r) => r.a)).toEqual(nasty.map((r) => r.a))
  })
})

describe('query', () => {
  const rows = [
    { name: 'Bob', age: 40, score: 1.5 },
    { name: 'Ada', age: 36, score: 9.2 },
    { name: 'Cy', age: 36, score: 3.0 },
  ]

  test('sortRows numeric asc, stable on ties', () => {
    const sorted = sortRows(rows, { columnId: 'age', dir: 'asc' }, cols)
    expect(sorted.map((r) => r.name)).toEqual(['Ada', 'Cy', 'Bob'])
  })

  test('sortRows text desc', () => {
    const sorted = sortRows(rows, { columnId: 'name', dir: 'desc' }, cols)
    expect(sorted.map((r) => r.name)).toEqual(['Cy', 'Bob', 'Ada'])
  })

  test('filterRows across all columns', () => {
    expect(filterRows(rows, { query: 'ada' }).map((r) => r.name)).toEqual(['Ada'])
    expect(filterRows(rows, { query: '36', columnId: 'age' }).length).toBe(2)
  })

  test('pageRows filters then sorts then slices', () => {
    const page = pageRows(
      rows,
      { sort: { columnId: 'score', dir: 'desc' }, offset: 0, limit: 2 },
      cols,
    )
    expect(page.total).toBe(3)
    expect(page.rows.map((r) => r.name)).toEqual(['Ada', 'Cy'])
  })
})

describe('summarize', () => {
  const model: TableModel = { id: 't1', title: 'People', columns: cols, rowCount: 1000 }
  test('summarizeTable returns dims + sample only', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ name: `p${i}`, age: i, score: i }))
    const s = summarizeTable(model, rows, 5)
    expect(s.rows).toBe(1000)
    expect(s.cols).toBe(3)
    expect(s.sample.length).toBe(5)
    expect(summaryToText(s)).toContain('1000 rows × 3 cols')
  })
})

describe('chart spec', () => {
  test('defaultChartSpec picks encodings', () => {
    expect(defaultChartSpec('bar', cols)).toEqual({ kind: 'bar', x: 'name', y: ['age', 'score'] })
    expect(defaultChartSpec('pie', cols)).toEqual({ kind: 'pie', x: 'name', y: 'age' })
    const xy: TableColumn[] = [
      { id: 'x', title: 'X', type: 'float' },
      { id: 'y', title: 'Y', type: 'float' },
    ]
    expect(defaultChartSpec('scatter', xy)).toEqual({ kind: 'scatter', x: 'x', y: 'y' })
  })

  test('validateChartSpec', () => {
    expect(validateChartSpec({ kind: 'bar', x: 'name', y: ['age'] }, cols).ok).toBe(true)
    expect(validateChartSpec({ kind: 'bar', y: ['age'] }, cols).ok).toBe(false)
    expect(validateChartSpec({ kind: 'pie', x: 'name', y: 'name' }, cols).ok).toBe(false)
  })
})

describe('formatCell', () => {
  test('scalars', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined as unknown as null)).toBe('')
    expect(formatCell(true)).toBe('true')
    expect(formatCell(false)).toBe('false')
    expect(formatCell(42)).toBe('42')
    expect(formatCell('hi')).toBe('hi')
  })
  test('objects and arrays render as JSON, never [object Object]', () => {
    // A Postgres jsonb / a Mongo nested field arrives as a JS object at runtime.
    expect(formatCell({ k: [1, 2], s: 'x' })).toBe('{"k":[1,2],"s":"x"}')
    expect(formatCell([1, 2, 3])).toBe('[1,2,3]')
    expect(formatCell({ k: [1, 2] })).not.toContain('[object Object]')
  })
  test('binary (Uint8Array/Buffer) renders as bounded hex, not a byte-array blob', () => {
    expect(formatCell(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('\\xdeadbeef')
    const big = formatCell(new Uint8Array(100))
    expect(big).toContain('(100 bytes)')
    expect(big).not.toContain('"data"')
  })
})
