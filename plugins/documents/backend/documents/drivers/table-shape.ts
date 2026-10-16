/**
 * Shape a spreadsheet matrix (a header row + data rows of mixed native values) into
 * a `@localixai/dataview`-compatible `{ columns, rows }`. Reuses dataview's column
 * inference + cell coercion so an xlsx extraction lines up with a CSV one and the
 * The table tab can render either. Pure — no host dependencies.
 */
import {
  coerceCell,
  inferColumns,
  type TableCellValue,
  type TableColumn,
  type TableRow,
} from '@localixai/dataview'

/** Render a raw spreadsheet cell as a string for header/type inference. */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}

/** Normalize a raw cell into a coercible scalar (Date → ISO, object → JSON string). */
function normalizeCell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v
  if (typeof v === 'bigint') return String(v)
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v) ?? null
  } catch {
    return null
  }
}

export interface TableFromMatrixOptions {
  /** First row is a header of column titles (default true). */
  header?: boolean
  /** Cap the number of DATA rows returned (drops the rest; caller flags truncation). */
  maxRows?: number
}

export interface ShapedTable {
  columns: TableColumn[]
  rows: TableRow[]
  /** Total data-row count before any `maxRows` cap (so the caller can flag truncation). */
  total: number
}

/** Turn a matrix (array of rows, each an array of native cell values) into a table. */
export function tableFromMatrix(
  matrix: unknown[][],
  opts: TableFromMatrixOptions = {},
): ShapedTable {
  const header = opts.header ?? true
  if (matrix.length === 0) return { columns: [], rows: [], total: 0 }

  const rawHeader = header ? matrix[0] : matrix[0].map((_, i) => `Column ${i + 1}`)
  const headerRow = rawHeader.map((h, i) => cellToString(h) || `Column ${i + 1}`)
  const width = headerRow.length

  const dataMatrix = (header ? matrix.slice(1) : matrix).filter((r) =>
    r.some((c) => c !== null && c !== undefined && cellToString(c) !== ''),
  )
  const total = dataMatrix.length

  const dataAsStrings = dataMatrix.map((r) =>
    Array.from({ length: width }, (_, i) => cellToString(r[i])),
  )
  const columns = inferColumns(headerRow, dataAsStrings)

  const capped = opts.maxRows != null ? dataMatrix.slice(0, opts.maxRows) : dataMatrix
  const rows: TableRow[] = capped.map((r) => {
    const row: TableRow = {}
    columns.forEach((col, idx) => {
      row[col.id] = coerceCell(normalizeCell(r[idx]) as TableCellValue, col.type)
    })
    return row
  })

  return { columns, rows, total }
}
