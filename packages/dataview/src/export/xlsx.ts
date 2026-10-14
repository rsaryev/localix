/**
 * XLSX exporter DECLARATION (no byte encoding here).
 *
 * Encoding an `.xlsx` workbook needs a spreadsheet library (SheetJS), which would
 * break this package's zero-runtime-dependency guarantee. So dataview only DECLARES
 * the format — id / label / mime / extension — and an extension can register a
 * real serializer over the same `EXPORT_FORMATS.xlsx` id.
 * That id is the ONLY thing binding the two halves; it is declared once, in
 * `export/registry.ts`, so the host cannot miss it by a character and leave the
 * throwing stub below reachable.
 *
 * Declaring it here means the format appears in the SHARED export menu and the
 * open-target catalog with zero rewiring — the UI reads `createDefaultExporterRegistry()`
 * to list formats but always downloads through the server export route, so the
 * throwing `serialize` below is never reached on the client.
 */

import { EXPORT_FORMATS, type TableExporter } from './registry'

/** Canonical OOXML spreadsheet media type shared by document-capable consumers. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const xlsxExporter: TableExporter = {
  id: EXPORT_FORMATS.xlsx,
  label: 'Excel (XLSX)',
  mimeType: XLSX_MIME,
  extension: 'xlsx',
  serialize() {
    // The real workbook bytes are produced host-side (SheetJS). Reaching here means
    // someone tried to serialize XLSX in a zero-dep context — use the server route.
    throw new Error(
      'XLSX serialization is provided by the host (SheetJS) — export through the server route, not client-side.',
    )
  },
}
