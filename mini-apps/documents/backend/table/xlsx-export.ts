/**
 * Server-side XLSX serializer. `@localixai/dataview` declares the `xlsx` export
 * format (id/label/mime/extension) but can't encode the bytes without a spreadsheet
 * library — that would break its zero-runtime-dep guarantee. So the real workbook
 * bytes are produced HERE (SheetJS, loaded lazily by this mini app) and registered
 * over dataview's declaration in `createTableService`.
 *
 * SheetJS loads lazily on first export via `createRequire` (a sync CJS load), so it
 * never rides the API boot path — matching the documents xlsx driver's lazy pattern.
 */
import { createRequire } from 'node:module'
import {
  formatCell,
  XLSX_MIME,
  type TableColumn,
  type TableExporter,
  type TableRow,
} from '@localixai/dataview'

const require = createRequire(import.meta.url)

/** The slice of the SheetJS surface we use — kept narrow + typed at the seam. */
interface SheetJs {
  utils: {
    aoa_to_sheet: (data: unknown[][]) => unknown
    book_new: () => unknown
    book_append_sheet: (wb: unknown, ws: unknown, name?: string) => void
  }
  write: (wb: unknown, opts: { type: 'buffer'; bookType: 'xlsx' }) => Uint8Array
}

let cached: SheetJs | null = null
function loadXlsx(): SheetJs {
  if (!cached) cached = require('xlsx') as SheetJs
  return cached
}

/**
 * Coerce a cell for a spreadsheet cell: primitives + Dates stay native (so numbers
 * sort/format as numbers in Excel), everything else (objects/arrays/binary) becomes
 * the same readable text a CSV export uses — never `[object Object]`.
 */
function cellForXlsx(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'string') return value as string | number | boolean
  if (value instanceof Date) return value
  return formatCell(value)
}

/** One sheet of a workbook: an optional tab name plus the dataview table shape. */
export interface WorkbookSheet {
  name?: string
  columns: TableColumn[]
  rows: TableRow[]
}

/**
 * Excel sheet-name rules enforced at the ONE encoding seam: ≤31 chars, none of
 * `[ ] : * ? / \`, non-empty, unique per workbook (case-insensitive). A model-
 * authored name that breaks them is repaired, not rejected — the content is the
 * deliverable, the tab label is presentation.
 */
function safeSheetName(raw: string | undefined, index: number, used: Set<string>): string {
  const base =
    (raw ?? '')
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || `Sheet${index + 1}`
  let candidate = base
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** Serialize one or more dataview tables to `.xlsx` workbook bytes — one sheet each. */
export function toXlsxWorkbook(sheets: WorkbookSheet[]): Uint8Array {
  const XLSX = loadXlsx()
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  sheets.forEach((sheet, index) => {
    const header = sheet.columns.map((c) => c.title)
    const body = sheet.rows.map((row) => sheet.columns.map((c) => cellForXlsx(row[c.id])))
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheet.name, index, used))
  })
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/** Serialize a dataview table to `.xlsx` workbook bytes (a single "Sheet1"). */
export function toXlsx(columns: TableColumn[], rows: TableRow[]): Uint8Array {
  return toXlsxWorkbook([{ columns, rows }])
}

/** The real `xlsx` exporter registered over dataview's declaration in the table service. */
export function createXlsxTableExporter(): TableExporter {
  return {
    id: 'xlsx',
    label: 'Excel (XLSX)',
    mimeType: XLSX_MIME,
    extension: 'xlsx',
    serialize: (columns, rows) => toXlsx(columns, rows),
  }
}
