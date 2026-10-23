// Generic, framework-free clipboard builders for a single data-grid row: a JSON object and
// a single cell's display text. Used by the shared inspector TableGrid for ANY table (the
// read-only Table tab, a database result, …). SQL-specific "copy row as INSERT" lives in the
// owning contribution and is fed to the grid through the generic `extraRowCopy` prop.
import { formatCell, type TableRow } from '@localixai/dataview'
import type { TableCopyColumn } from '@localixai/mini-app-sdk/ui/table'

/** The minimal column shape the copy builders need — the grid's column satisfies it. */
export type CopyColumn = TableCopyColumn

/**
 * One result row as a pretty-printed JSON object keyed by column TITLE. Raw cell values are
 * preserved (null stays null, numbers/booleans keep their type); a column absent from the
 * row becomes null so every column appears as a key.
 */
export function rowToJson(columns: ReadonlyArray<CopyColumn>, row: TableRow): string {
  const obj: Record<string, unknown> = {}
  for (const col of columns) obj[col.title] = row[col.id] ?? null
  return JSON.stringify(obj, null, 2)
}

/** One cell's display text — the exact string the grid renders (via dataview formatCell). */
export function cellToText(row: TableRow, columnId: string): string {
  return formatCell(row[columnId])
}
