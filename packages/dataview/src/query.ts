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

/** One collator for every comparison — `localeCompare` with options builds one per call. */
const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

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
  // A blank is not a value, so it has no place in the ordering OF values: it sinks whichever
  // way the ordering runs, in its original order. Blanks are split off before sorting, which
  // keeps them outside the `dir` multiplication — that is the whole point.
  const ranked: Array<{ row: TableRow; key: number | string; index: number }> = []
  const blanks: TableRow[] = []
  rows.forEach((row, index) => {
    const value = row[sort.columnId]
    if (isBlank(value, numeric)) blanks.push(row)
    else ranked.push({ row, key: numeric ? numericValue(value) : String(value), index })
  })
  // Stable: keys are computed once per row, ties restore the original order.
  ranked.sort((x, y) => {
    const c = numeric
      ? (x.key as number) - (y.key as number)
      : TEXT_COLLATOR.compare(x.key as string, y.key as string)
    return c * dir || x.index - y.index
  })
  return [...ranked.map((entry) => entry.row), ...blanks]
}

/**
 * Lowercased display text per row, computed once per row object and reused across keystrokes.
 * Rows are treated as immutable: a data change produces new row objects (new cache entries),
 * and dropped rows are released with their WeakMap keys.
 */
const LOWER_TEXT = new WeakMap<TableRow, Map<string, string>>()

function lowerCellText(row: TableRow, id: string): string {
  let cells = LOWER_TEXT.get(row)
  if (!cells) {
    cells = new Map()
    LOWER_TEXT.set(row, cells)
  }
  let text = cells.get(id)
  if (text === undefined) {
    text = formatCell(row[id]).toLowerCase()
    cells.set(id, text)
  }
  return text
}

export function filterRows(rows: TableRow[], filter: FilterSpec | undefined): TableRow[] {
  if (!filter?.query.trim()) return rows
  const q = filter.query.trim().toLowerCase()
  if (filter.columnId) {
    const id = filter.columnId
    return rows.filter((r) => lowerCellText(r, id).includes(q))
  }
  return rows.filter((r) => Object.keys(r).some((id) => lowerCellText(r, id).includes(q)))
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
