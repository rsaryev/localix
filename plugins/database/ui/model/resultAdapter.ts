// Adapt a driver-agnostic DbResultSet (columns + row-major cells) into the
// @localixai/dataview model (typed columns + rows keyed by column id) so the
// existing virtualized TableGrid renders SQL results with zero bespoke grid code.
import type { TableCellType, TableCellValue, TableColumn, TableRow } from '@localixai/dataview'
import type { DbResultSet } from '../dbClient'
import { binaryBytes, binaryHex } from '../../shared/binary-value'
import { exactJsonInteger, stringifyJsonExact } from '../../shared/exact-json'
import { defineRecordValue } from '../../shared/safe-record'

export interface AdaptedResult {
  columns: TableColumn[]
  rows: TableRow[]
  /**
   * Exact cells keyed by the render-row object. Sort/filter preserve row identity, letting
   * exports and PK mutations use driver values while the grid renders compact primitives.
   */
  rawValues?: WeakMap<TableRow, Readonly<Record<string, unknown>>>
  /** The engine returned more rows than the result cap; these are the first of them. */
  truncated?: boolean
}

/** Read the exact driver value when `row` belongs to this result, else its displayed value. */
export function adaptedCellValue(result: AdaptedResult, row: TableRow, columnId: string): unknown {
  const raw = result.rawValues?.get(row)
  return raw && Object.hasOwn(raw, columnId) ? raw[columnId] : (row[columnId] ?? null)
}

/** Convert keyed grid rows back to records without collapsing duplicate SQL labels. */
export function adaptedRowsToRecords(
  result: AdaptedResult,
  rows: ReadonlyArray<TableRow>,
): Array<Record<string, unknown>> {
  return rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column) => [column.id, adaptedCellValue(result, row, column.id)]),
    ),
  )
}

/**
 * Make exact values textual for CSV/TSV. In particular, BLOBs become a complete hex
 * string rather than the bounded display marker, so export never invents `[blob 42B]` data.
 */
export function adaptedRowsForTextExport(
  result: AdaptedResult,
  rows: ReadonlyArray<TableRow>,
): TableRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column) => [
        column.id,
        coerceForTextExport(adaptedCellValue(result, row, column.id)),
      ]),
    ),
  )
}

/** A stable, unique column id even when a query yields duplicate/blank labels. */
function uniqueId(name: string, index: number, seen: Set<string>): string {
  const base = name.length > 0 ? name : `col_${index}`
  let id = base
  let n = 1
  while (seen.has(id)) id = `${base}_${n++}`
  seen.add(id)
  return id
}

/** Best-effort cell type from the first non-null value in a column. */
function inferType(sample: unknown): TableCellType {
  if (typeof sample === 'number') return Number.isInteger(sample) ? 'int' : 'float'
  if (typeof sample === 'bigint') return 'int'
  if (typeof sample === 'boolean') return 'bool'
  return 'text'
}

/** Coerce an arbitrary SQL cell into a dataview-renderable primitive. Values arrive
 *  already JSON-serialized over the wire, so Dates are ISO strings and Postgres
 *  json/array columns are plain objects/arrays — stringify those for display. */
function coerce(value: unknown): TableCellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (typeof value === 'bigint') return exactJsonInteger(value)
  const bytes = binaryBytes(value)
  if (bytes) return `[blob ${bytes.length}B]`
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return stringifyJsonExact(value) ?? null
    } catch {
      return '[unserializable]'
    }
  }
  return String(value as number | boolean | bigint | symbol)
}

function coerceForTextExport(value: unknown): TableCellValue {
  const hex = binaryHex(value)
  if (hex !== null) return `\\x${hex}`
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    try {
      return stringifyJsonExact(value) ?? null
    } catch {
      return '[unserializable]'
    }
  }
  return coerce(value)
}

export function adaptResult(result: DbResultSet): AdaptedResult {
  const seen = new Set<string>()
  const ids = result.columns.map((c, i) => uniqueId(c.name, i, seen))

  const columns: TableColumn[] = result.columns.map((c, i) => {
    const sample = result.rows.find((r) => r[i] !== null && r[i] !== undefined)?.[i]
    return { id: ids[i], title: c.name || ids[i], type: inferType(sample) }
  })

  const rawValues = new WeakMap<TableRow, Readonly<Record<string, unknown>>>()
  const rows: TableRow[] = result.rows.map((cells) => {
    const row: TableRow = {}
    const raw: Record<string, unknown> = {}
    for (let i = 0; i < ids.length; i++) defineRecordValue(row, ids[i]!, coerce(cells[i]))
    for (let i = 0; i < ids.length; i++) defineRecordValue(raw, ids[i]!, cells[i])
    rawValues.set(row, raw)
    return row
  })

  return { columns, rows, rawValues, ...(result.truncated ? { truncated: true } : {}) }
}
