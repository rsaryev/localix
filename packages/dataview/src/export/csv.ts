/** RFC-4180 CSV exporter. */

import { formatCell, type TableColumn, type TableRow } from '../model'
import { EXPORT_FORMATS, type TableExporter } from './registry'

/** Quote a field iff it contains a delimiter, quote, or newline; escape `"` as `""`. */
export function csvEscape(value: string, delimiter = ','): string {
  if (
    value.includes('"') ||
    value.includes(delimiter) ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsv(columns: TableColumn[], rows: TableRow[], delimiter = ','): string {
  const header = columns.map((c) => csvEscape(c.title, delimiter)).join(delimiter)
  const lines = rows.map((row) => {
    const line = columns.map((c) => csvEscape(formatCell(row[c.id]), delimiter)).join(delimiter)
    // A record of one empty field serializes to an EMPTY LINE, which is
    // indistinguishable from the terminator of the line above it — the row is
    // simply gone when the file is read back. Quote it so the field is explicit.
    // Only the all-empty single-field case is ambiguous: with two columns the
    // delimiter is itself evidence that a record is there.
    return line === '' ? '""' : line
  })
  return [header, ...lines].join('\r\n')
}

export const csvExporter: TableExporter = {
  id: EXPORT_FORMATS.csv,
  label: 'CSV',
  mimeType: 'text/csv',
  extension: 'csv',
  serialize: (columns, rows) => toCsv(columns, rows),
}
