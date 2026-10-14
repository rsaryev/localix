/**
 * Agnostic table data model — no React, no DOM, no Node.
 * A dataset is `columns` (typed descriptors) + `rows` (objects keyed by column id).
 * The same model backs the grid renderer, the chart renderers, export, and the
 * cheap model-facing summary.
 */

export type TableCellType = 'text' | 'number' | 'int' | 'float' | 'bool' | 'date'

export type TableCellValue = string | number | boolean | null

export type TableAlign = 'left' | 'right' | 'center'

export interface TableColumn {
  /** Stable key used in row objects, sort/filter, and chart encodings. */
  id: string
  /** Human-facing header. */
  title: string
  type: TableCellType
  align?: TableAlign
  /** Defaults to true; set false to lock a column from header-click sorting. */
  sortable?: boolean
  /** Optional preferred pixel width (renderer hint). */
  width?: number
}

export type TableRow = Record<string, TableCellValue>

export interface TableModel {
  id: string
  title?: string
  columns: TableColumn[]
  /** Total row count of the backing dataset (may exceed rows currently loaded). */
  rowCount: number
}

export function isNumericType(type: TableCellType): boolean {
  return type === 'number' || type === 'int' || type === 'float'
}

/** Numbers align right, everything else left, unless the column overrides it. */
export function resolveAlign(column: TableColumn): TableAlign {
  return column.align ?? (isNumericType(column.type) ? 'right' : 'left')
}

/** Coerce a raw parsed value into the column's typed cell value. */
export function coerceCell(
  raw: string | number | boolean | null | undefined,
  type: TableCellType,
): TableCellValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' && raw.length === 0) return null

  switch (type) {
    case 'int':
    case 'float':
    case 'number': {
      if (typeof raw === 'number') return raw
      if (typeof raw === 'boolean') return raw ? 1 : 0
      const n = Number(raw)
      return Number.isNaN(n) ? null : n
    }
    case 'bool': {
      if (typeof raw === 'boolean') return raw
      const s = String(raw).trim().toLowerCase()
      if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true
      if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false
      return null
    }
    case 'date':
    case 'text':
      return String(raw)
  }
}

/** Render a cell value as a display string (renderer + export share this). Accepts
 *  `unknown` because a driver can put a non-scalar in a row at runtime despite the
 *  declared `TableCellValue` — a Postgres `jsonb`/array column, a Mongo/ES nested field —
 *  and those must render as JSON, never the useless `String(obj)` → "[object Object]". */
const HEX_DISPLAY_CAP = 32

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  // Binary (Postgres bytea / MySQL BLOB come back as a Buffer, i.e. a Uint8Array): a
  // compact, BOUNDED hex string (`\xdeadbeef`) — never the giant `{"type":"Buffer",…}` a
  // JSON.stringify would produce, and capped so a large blob can't flood the cell.
  if (value instanceof Uint8Array) {
    let hex = ''
    for (let i = 0; i < Math.min(value.length, HEX_DISPLAY_CAP); i++)
      hex += value[i]!.toString(16).padStart(2, '0')
    return value.length > HEX_DISPLAY_CAP ? `\\x${hex}… (${value.length} bytes)` : `\\x${hex}`
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[unserializable]'
    }
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    return Object.prototype.toString.call(value)
  }
  return String(value as string | number | bigint)
}
