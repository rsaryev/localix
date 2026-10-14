/**
 * Pure sort/filter/page over rows — the SAME code runs server-side (large
 * file-backed tables) and client-side (small inline tables), so results match.
 */

import {
  formatCell,
  isNumericType,
  type TableCellValue,
  type TableColumn,
  type TableRow,
} from './model'

export interface SortSpec {
  columnId: string
  dir: 'asc' | 'desc'
}

export interface FilterSpec {
  /** Restrict to one column; omit to match across all columns. */
  columnId?: string
  query: string
}

export interface QuerySpec {
  sort?: SortSpec
  filter?: FilterSpec
}

export interface PageSpec extends QuerySpec {
  offset?: number
  limit?: number
}

export interface PagedRows {
  rows: TableRow[]
  /** Total rows after filtering (for sizing the virtual scroller). */
  total: number
  offset: number
  limit: number
}

function numericValue(value: TableCellValue): number {
  return typeof value === 'number' ? value : Number(value)
}

/**
 * Whether a cell holds no value to rank: null/undefined, or — in a numeric column —
 * something that is not a number at all.
 *
 * Blanks are separated from the comparison instead of being ranked inside it. When
 * "nulls last" was expressed as a return value, the caller multiplied it by the sort
 * direction along with every real comparison, so a descending sort floated every
 * blank cell to the TOP and buried the data the user had just asked to rank.
 */
function isBlank(value: TableCellValue, numeric: boolean): boolean {
  if (value === null || value === undefined) return true
  return numeric && Number.isNaN(numericValue(value))
}

/** Order two NON-blank cells. Blanks never reach here — see {@link isBlank}. */
function compareValues(a: TableCellValue, b: TableCellValue, numeric: boolean): number {
  if (numeric) {
    const an = numericValue(a)
    const bn = numericValue(b)
    return an - bn
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows(
  rows: TableRow[],
  sort: SortSpec | undefined,
  columns: TableColumn[],
): TableRow[] {
  if (!sort) return rows
  const col = columns.find((c) => c.id === sort.columnId)
  if (!col) return rows
  const numeric = isNumericType(col.type)
  const dir = sort.dir === 'desc' ? -1 : 1
  // Stable: decorate with original index, restore on ties.
  return rows
    .map((row, i) => [row, i] as const)
    .sort((x, y) => {
      const a = x[0][sort.columnId]
      const b = y[0][sort.columnId]
      // A blank is not a value, so it has no place in the ordering OF values: it
      // sinks whichever way the ordering runs. Deliberately outside the `dir`
      // multiplication below — that is the whole point.
      const aBlank = isBlank(a, numeric)
      const bBlank = isBlank(b, numeric)
      if (aBlank || bBlank) {
        if (aBlank && bBlank) return x[1] - y[1]
        return aBlank ? 1 : -1
      }
      const c = compareValues(a, b, numeric) * dir
      return c !== 0 ? c : x[1] - y[1]
    })
    .map(([row]) => row)
}

export function filterRows(rows: TableRow[], filter: FilterSpec | undefined): TableRow[] {
  if (!filter?.query.trim()) return rows
  const q = filter.query.trim().toLowerCase()
  const matches = (value: unknown) => formatCell(value).toLowerCase().includes(q)
  if (filter.columnId) {
    const id = filter.columnId
    return rows.filter((r) => matches(r[id]))
  }
  return rows.filter((r) => Object.values(r).some(matches))
}

export function queryRows(rows: TableRow[], spec: QuerySpec, columns: TableColumn[]): TableRow[] {
  return sortRows(filterRows(rows, spec.filter), spec.sort, columns)
}

/** Filter → sort → slice. The server route's one-stop helper. */
export function pageRows(rows: TableRow[], spec: PageSpec, columns: TableColumn[]): PagedRows {
  const queried = queryRows(rows, spec, columns)
  const offset = Math.max(0, spec.offset ?? 0)
  const limit = spec.limit ?? queried.length
  return {
    rows: queried.slice(offset, offset + limit),
    total: queried.length,
    offset,
    limit,
  }
}
