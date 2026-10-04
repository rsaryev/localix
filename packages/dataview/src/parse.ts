/**
 * Parsing + column-type inference. Dependency-free RFC-4180-ish CSV/TSV parser
 * (handles quoted fields, "" escapes, CRLF/LF) plus JSON ingest.
 */

import {
  coerceCell,
  type TableCellType,
  type TableCellValue,
  type TableColumn,
  type TableRow,
} from './model'

export interface ParsedTable {
  columns: TableColumn[]
  rows: TableRow[]
}

export type TableFormat = 'csv' | 'tsv' | 'json'

/**
 * A genuinely BLANK line: one field, and that field empty.
 *
 * This filter used to be `!r.some((c) => c !== '')` — drop the row when EVERY cell is empty — which
 * silently ate real data: a row of `,` is two empty cells, not a blank line, and it round-tripped
 * from `toCsv` to zero rows. Measured before changing: a two-column table whose only row was
 * `{a:'', b:''}` exported and re-parsed as 0 rows.
 *
 * The line/all-empty distinction is exactly Papa Parse's (MIT) `testEmptyLine`:
 *
 *   skipEmptyLines === 'greedy' ? s.join('').trim() === '' : s.length === 1 && s[0].length === 0
 *
 * i.e. "all cells blank" is its opt-in `'greedy'` mode, while the plain default — and what a reader
 * of exported data wants — is the single-empty-field test used here. A trailing newline still
 * produces no row, because that line has exactly one empty field.
 */
function isBlankLine(cells: string[]): boolean {
  return cells.length === 1 && cells[0] === ''
}

/** Split delimited text into a matrix of string cells. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // A field can be present and still be EMPTY — `""` is a field, the absence of one
  // is not. Length alone cannot tell them apart, so remember that a field was opened.
  // Without this, a one-column file ending in `""` (no trailing newline) lost its
  // last row entirely: at EOF both `field` and `row` were empty, exactly as they are
  // after a normal trailing terminator.
  let fieldOpened = false
  let i = 0
  const n = text.length
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1 // strip BOM

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      fieldOpened = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      fieldOpened = false
      i++
      continue
    }
    if (ch === '\r') {
      row.push(field)
      field = ''
      fieldOpened = false
      rows.push(row)
      row = []
      if (text[i + 1] === '\n') i += 2
      else i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      field = ''
      fieldOpened = false
      rows.push(row)
      row = []
      i++
      continue
    }
    field += ch
    i++
  }
  // A trailing terminator ENDS the last record rather than starting another, so an
  // empty tail is normally nothing. `fieldOpened` is what distinguishes that from a
  // real, explicitly-quoted empty final field.
  if (field.length > 0 || row.length > 0 || fieldOpened) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
const BOOL_RE = /^(true|false|yes|no)$/i

function isIsoDateLike(s: string): boolean {
  return ISO_DATE_RE.test(s)
}

/** Infer a column type from a sample of raw string values. */
export function inferType(values: Array<string | null | undefined>): TableCellType {
  const nonEmpty = values.flatMap((v) => {
    if (v === null || v === undefined) return []
    const s = String(v).trim()
    return s !== '' ? [s] : []
  })
  if (nonEmpty.length === 0) return 'text'

  let allInt = true
  let allNum = true
  let allBool = true
  let allDate = true
  for (const s of nonEmpty) {
    if (allBool && !BOOL_RE.test(s)) allBool = false
    const num = Number(s)
    if (Number.isNaN(num)) {
      allNum = false
      allInt = false
    } else if (!Number.isInteger(num)) {
      allInt = false
    }
    if (allDate && !isIsoDateLike(s)) allDate = false
  }
  if (allInt) return 'int'
  if (allNum) return 'float'
  if (allBool) return 'bool'
  if (allDate) return 'date'
  return 'text'
}

function inferTypeFromValues(values: TableCellValue[]): TableCellType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (nonNull.length === 0) return 'text'
  if (nonNull.every((v) => typeof v === 'boolean')) return 'bool'
  if (nonNull.every((v) => typeof v === 'number')) {
    return nonNull.every((v) => Number.isInteger(v as number)) ? 'int' : 'float'
  }
  return inferType(nonNull.map((v) => String(v)))
}

function makeColumnId(title: string, index: number, used: Set<string>): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `col_${index + 1}`
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

/** Infer columns (id + title + type) from CSV headers + a sample of data rows. */
export function inferColumns(headers: string[], sampleRows: string[][]): TableColumn[] {
  const used = new Set<string>()
  const sample = sampleRows.slice(0, 200)
  return headers.map((h, idx) => {
    const title = (h ?? '').trim() || `Column ${idx + 1}`
    const id = makeColumnId(title, idx, used)
    const colValues = sample.map((r) => r[idx] ?? '')
    return { id, title, type: inferType(colValues) }
  })
}

/** Infer columns from an array of row objects (JSON). Object keys are the ids. */
export function inferColumnsFromObjects(rows: TableRow[]): TableColumn[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const r of rows.slice(0, 200)) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return keys.map((k) => {
    const sample = rows.slice(0, 200).map((r) => r[k])
    return { id: k, title: k, type: inferTypeFromValues(sample) }
  })
}

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
  const columns =
    parsed.columns && parsed.columns.length > 0
      ? parsed.columns
      : inferColumnsFromObjects(parsed.rows)
  const rows = parsed.rows.map((r) => {
    const out: TableRow = {}
    for (const col of columns) {
      const v = r[col.id]
      out[col.id] = v === undefined ? null : v
    }
    return out
  })
  return { columns, rows }
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
