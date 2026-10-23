/**
 * XLSX generator — model-authored content to a real `.xlsx` workbook. Accepts EITHER a
 * Markdown pipe table OR JSON (array-of-arrays, array-of-objects, or `{ columns, rows }`)
 * and shapes it into a `@localixai/dataview` `{ columns, rows }`, then encodes the bytes
 * with the EXISTING server SheetJS serializer (`features/table/xlsx-export.ts` `toXlsx`)
 * — no duplicate spreadsheet encoding. Pure aside from that lazy SheetJS load.
 */
import type { TableColumn, TableRow } from '@localixai/dataview'
import { toXlsxWorkbook, type WorkbookSheet } from '../../table/xlsx-export'
import { tableFromMatrix } from '../drivers/table-shape'
import { firstTableBlock } from '../markdown/blocks'
import { DocumentError } from '../errors'

interface ShapedTable {
  columns: TableColumn[]
  rows: TableRow[]
}

/** Union of the object keys across rows, preserving first-seen order. */
function unionKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return keys
}

/** Shape parsed JSON into a table (array-of-arrays / array-of-objects / {columns,rows}). */
function shapeFromJson(value: unknown): ShapedTable {
  // { columns, rows }: a ready dataview TableModel when columns carry ids, else a matrix.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as { columns?: unknown; rows?: unknown }
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const cols = obj.columns as unknown[]
      const first = cols[0]
      if (first && typeof first === 'object' && 'id' in (first as object)) {
        return { columns: cols as TableColumn[], rows: obj.rows as TableRow[] }
      }
      // Columns are strings → header row + object/array data rows → matrix.
      const header = cols.map((c) => String(c))
      const matrix = [
        header,
        ...(obj.rows as unknown[]).map((r) =>
          Array.isArray(r) ? r : header.map((h) => (r as Record<string, unknown>)?.[h]),
        ),
      ]
      return tableFromMatrix(matrix, { header: true })
    }
    throw new DocumentError('generate_failed', 'xlsx JSON object must have `columns` and `rows`')
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { columns: [], rows: [] }
    // Array of arrays → first row is the header.
    if (value.every((r) => Array.isArray(r))) {
      return tableFromMatrix(value as unknown[][], { header: true })
    }
    // Array of objects → derive a header from the union of keys.
    if (value.every((r) => r && typeof r === 'object')) {
      const objs = value as Record<string, unknown>[]
      const header = unionKeys(objs)
      const matrix = [header, ...objs.map((o) => header.map((h) => o[h]))]
      return tableFromMatrix(matrix, { header: true })
    }
    // Array of primitives → a single "Value" column.
    return tableFromMatrix([['Value'], ...value.map((v) => [v])], { header: true })
  }

  throw new DocumentError('generate_failed', 'xlsx content must be JSON rows or a Markdown table')
}

/** Parse content (JSON or Markdown table) into a shaped table. */
function parseTabular(content: string): ShapedTable {
  const trimmed = content.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new DocumentError(
        'generate_failed',
        'xlsx content looked like JSON but failed to parse',
      )
    }
    return shapeFromJson(parsed)
  }

  const table = firstTableBlock(content)
  if (!table) {
    throw new DocumentError(
      'generate_failed',
      'xlsx content must be a Markdown pipe table or JSON rows',
    )
  }
  return tableFromMatrix([table.header, ...table.rows], { header: true })
}

/**
 * A multi-sheet workbook request: `{ sheets: [{ name?, columns?, rows }, …] }`.
 * Each sheet reuses the exact single-table JSON shapes (`{columns, rows}` or bare
 * rows), so the model learns ONE tabular contract and wraps it per tab.
 */
function parseWorkbook(value: unknown): WorkbookSheet[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sheets = (value as { sheets?: unknown }).sheets
  if (!Array.isArray(sheets)) return null
  if (sheets.length === 0) {
    throw new DocumentError('generate_failed', 'xlsx `sheets` must contain at least one sheet')
  }
  return sheets.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new DocumentError(
        'generate_failed',
        `xlsx sheets[${index}] must be an object with rows (and optional name/columns)`,
      )
    }
    const sheet = entry as { name?: unknown; columns?: unknown; rows?: unknown }
    const shaped = shapeFromJson(
      sheet.columns !== undefined ? { columns: sheet.columns, rows: sheet.rows } : sheet.rows,
    )
    return {
      ...(typeof sheet.name === 'string' && sheet.name.trim() ? { name: sheet.name } : {}),
      ...shaped,
    }
  })
}

/** Generate `.xlsx` bytes from a Markdown table, JSON rows, or a `{sheets:[…]}` workbook. */
export function contentToXlsx(content: string): Uint8Array {
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new DocumentError(
        'generate_failed',
        'xlsx content looked like JSON but failed to parse',
      )
    }
    const workbook = parseWorkbook(parsed)
    if (workbook) return toXlsxWorkbook(workbook)
    return toXlsxWorkbook([shapeFromJson(parsed)])
  }
  const { columns, rows } = parseTabular(content)
  return toXlsxWorkbook([{ columns, rows }])
}
