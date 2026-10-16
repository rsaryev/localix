/**
 * XLSX driver — spreadsheets to a dataview-compatible table. `xlsx` (SheetJS) reads
 * the workbook from the raw bytes; a sheet is turned into a header-row + data-row
 * matrix (`sheet_to_json` with `header:1`) and shaped by {@link tableFromMatrix} so
 * the emitted `{ columns, rows }` matches a CSV extraction.
 *
 * The SheetJS lib loads via dynamic `import()` on first use. `options.sheet` selects
 * a sheet by name or 0-based index (default: the first sheet); row windowing
 * (`offset`/`limit`) is applied by the service.
 */
import type { DocumentConverter, DocumentInput, ExtractedTableDocument } from '../contracts'
import { DocumentError } from '../errors'
import { tableFromMatrix } from './table-shape'

interface XlsxLib {
  read: (
    data: Uint8Array,
    opts?: Record<string, unknown>,
  ) => { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json: <T = unknown>(sheet: unknown, opts?: Record<string, unknown>) => T[] }
}

function unwrapXlsx(mod: unknown): XlsxLib {
  const m = mod as { read?: unknown; default?: unknown }
  return (m?.read ? m : (m.default as XlsxLib)) as XlsxLib
}

/** Pick the target sheet name from a `sheet` selector (name or index). */
function resolveSheetName(sheetNames: string[], selector: string | number | undefined): string {
  if (selector === undefined) return sheetNames[0]
  if (typeof selector === 'number') return sheetNames[selector] ?? sheetNames[0]
  return sheetNames.includes(selector) ? selector : sheetNames[0]
}

export function createXlsxConverter(): DocumentConverter {
  return {
    async extract(input: DocumentInput): Promise<ExtractedTableDocument> {
      const XLSX = unwrapXlsx(await import('xlsx'))
      // `cellDates` yields real Date objects for date cells (nicer than serials).
      const wb = XLSX.read(input.bytes, { type: 'buffer', cellDates: true })
      const sheetNames = wb.SheetNames
      if (sheetNames.length === 0) {
        throw new DocumentError('extract_failed', 'workbook has no sheets')
      }
      const sheetName = resolveSheetName(sheetNames, input.options?.sheet)
      const sheet = wb.Sheets[sheetName]
      // header:1 → array-of-arrays (raw rows); defval keeps sparse cells aligned.
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: null,
      })

      const shaped = tableFromMatrix(matrix, { header: true })
      return {
        kind: 'table',
        columns: shaped.columns,
        rows: shaped.rows,
        metadata: {
          format: 'xlsx',
          sourceMediaType: input.mediaType,
          sheetNames,
          sheetName,
        },
      }
    },
  }
}
