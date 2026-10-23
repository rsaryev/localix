import type { TableColumn, TableRow } from '@localixai/dataview'
import { defineRecordValue } from '../../shared/safe-record'

/**
 * Reconstruct document objects from the flat grid result for the document/search consoles'
 * JSON view. The backend flattens nested values to compact JSON strings for the grid; here we
 * parse those back and re-key cells by their column title, dropping null/absent fields so each
 * document reads like its source (union columns don't pollute every doc with nulls).
 */
export function rowsToDocuments(
  columns: TableColumn[],
  rows: TableRow[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const doc: Record<string, unknown> = {}
    for (const col of columns) {
      const raw = row[col.id]
      if (raw === null || raw === undefined) continue
      // Bracket assignment treats the legacy `__proto__` setter specially instead of
      // creating a data property. MongoDB permits that field name, so define it explicitly:
      // the JSON view must neither lose the field nor let result data replace this object's
      // prototype. The same path keeps `constructor`/`prototype` as ordinary own keys.
      defineRecordValue(doc, col.title, maybeParseJson(raw))
    }
    return doc
  })
}

/** Parse a cell that looks like a JSON object/array back into its value; leave others as-is. */
function maybeParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}
