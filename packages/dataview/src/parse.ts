/**
 * Table import and column-type inference for delimited text and JSON.
 */

import { parseDelimited } from './delimited-text'
import { inferColumns, inferColumnsFromObjects } from './column-inference'
import { coerceCell, type TableCellValue, type TableColumn, type TableRow } from './model'

export interface ParsedTable {
  columns: TableColumn[]
  rows: TableRow[]
}

export type TableFormat = 'csv' | 'tsv' | 'json'

/** Skip single empty fields; a row of delimiters represents real empty cells. */
function isBlankLine(cells: string[]): boolean {
  return cells.length === 1 && cells[0] === ''
}

export { parseDelimited } from './delimited-text'

export { inferType, inferColumns, inferColumnsFromObjects } from './column-inference'

export function tableFromDelimited(
  text: string,
  opts?: { delimiter?: string; header?: boolean },
): ParsedTable {
  const delimiter = opts?.delimiter ?? ','
  const header = opts?.header ?? true
  const cells = parseDelimited(text, delimiter)
  if (cells.length === 0) return { columns: [], rows: [] }

  const headers = header ? cells[0] : cells[0].map((_, i) => `Column ${i + 1}`)
  const dataCells = (header ? cells.slice(1) : cells).filter((r) => !isBlankLine(r))
  const columns = inferColumns(headers, dataCells)
  const rows: TableRow[] = dataCells.map((cellRow) => {
    const row: TableRow = {}
    columns.forEach((col, idx) => {
      row[col.id] = coerceCell(cellRow[idx] ?? null, col.type)
    })
    return row
  })
  return { columns, rows }
}

function rowsFromObjects(data: unknown[]): TableRow[] {
  return data.map((d) => {
    if (d === null || typeof d !== 'object' || Array.isArray(d)) {
      return { value: d as TableCellValue }
    }
    const out: TableRow = {}
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      out[k] =
        v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
          ? (v as TableCellValue)
          : v === undefined
            ? null
            : JSON.stringify(v)
    }
    return out
  })
}

export function parseJson(text: string): { columns?: TableColumn[]; rows: TableRow[] } {
  const data: unknown = JSON.parse(text)
  if (Array.isArray(data)) return { rows: rowsFromObjects(data) }
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    const obj = data as { rows: unknown[]; columns?: TableColumn[] }
    return { columns: obj.columns, rows: rowsFromObjects(obj.rows) }
  }
  throw new Error('Unsupported JSON shape: expected an array of objects or { rows: [...] }')
}

export function tableFromJson(text: string): ParsedTable {
  const parsed = parseJson(text)
  const explicit = parsed.columns && parsed.columns.length > 0
  const columns = explicit ? parsed.columns! : inferColumnsFromObjects(parsed.rows)
  // `parseJson` already produced fresh row objects, so normalize them in place instead of
  // copying every row a second time: fill missing columns, drop keys outside the schema.
  const ids = new Set(columns.map((col) => col.id))
  for (const row of parsed.rows) {
    for (const col of columns) if (row[col.id] === undefined) row[col.id] = null
    for (const key of Object.keys(row)) if (!ids.has(key)) delete row[key]
  }
  return { columns, rows: parsed.rows }
}

export function formatFromExtension(path: string): TableFormat | undefined {
  const lower = path.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'tsv'
  if (lower.endsWith('.json')) return 'json'
  return undefined
}

/** Parse text into a table given an explicit format (or inferred from a path). */
export function parseTable(text: string, format: TableFormat): ParsedTable {
  switch (format) {
    case 'json':
      return tableFromJson(text)
    case 'tsv':
      return tableFromDelimited(text, { delimiter: '\t' })
    case 'csv':
      return tableFromDelimited(text, { delimiter: ',' })
  }
}
