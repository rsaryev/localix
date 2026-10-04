/**
 * Scalable export-format registry. CSV ships now; JSON/TSV/XLSX drop in later by
 * `register()`-ing a new exporter — the UI export menu and the server export route
 * both read this registry, so a new format appears in both with zero rewiring.
 */

import type { TableColumn, TableRow } from '../model'

/**
 * EXPORT-FORMAT IDS — the ONE authoritative declaration of the well-known format
 * strings (`csv`, `xlsx`).
 *
 * A format id is one piece of knowledge that THREE places must agree on, and the
 * only thing that binds them is the string itself:
 *   1. the exporter that DECLARES it (`csv.ts`, `xlsx.ts` → `TableExporter.id`);
 *   2. the open-target catalog that REQUESTS it (`open/targets.ts` → `exporterId`,
 *      resolved host-side as `registry.get(target.exporterId)`);
 *   3. the HOST that registers a real serializer OVER a declaration — `xlsx` ships
 *      here as a throwing stub on purpose (encoding a workbook needs SheetJS, which
 *      would break this package's zero-dependency guarantee), so `apps/api` registers
 *      the real one under the SAME id.
 *
 * Drift by one character and nothing fails loudly: the registry is a `Map<string, …>`,
 * so a mistyped host id registers a SECOND entry and leaves the throwing stub sitting
 * at `xlsx` — "Open in Numbers/Excel/LibreOffice" then throws at export time, having
 * type-checked clean. Declaring the ids once is what makes that drift impossible.
 *
 * A shared VOCABULARY, not a closed set: `TableExporter.id` stays `string` and the
 * registry accepts any id, so a host can still register a format that is not listed
 * here — exactly like a `ResourceRefProvider.provider` namespace.
 */
export const EXPORT_FORMATS = {
  csv: 'csv',
  xlsx: 'xlsx',
} as const

/** A well-known export-format id (`'csv'`, `'xlsx'`). */
export type ExportFormatId = (typeof EXPORT_FORMATS)[keyof typeof EXPORT_FORMATS]

/** The format used when a caller names none. */
export const DEFAULT_EXPORT_FORMAT: ExportFormatId = EXPORT_FORMATS.csv

export interface TableExporter {
  /** Stable id used in URLs/menus — see {@link EXPORT_FORMATS}, e.g. 'csv'. */
  id: string
  /** Human label, e.g. 'CSV'. */
  label: string
  mimeType: string
  /** File extension without the dot, e.g. 'csv'. */
  extension: string
  serialize(columns: TableColumn[], rows: TableRow[]): string | Uint8Array
}

export interface ExporterRegistry {
  register(exporter: TableExporter): void
  get(id: string): TableExporter | undefined
  has(id: string): boolean
  list(): TableExporter[]
}

export function createExporterRegistry(initial: TableExporter[] = []): ExporterRegistry {
  const map = new Map<string, TableExporter>()
  for (const e of initial) map.set(e.id, e)
  return {
    register(exporter) {
      map.set(exporter.id, exporter)
    },
    get(id) {
      return map.get(id)
    },
    has(id) {
      return map.has(id)
    },
    list() {
      return [...map.values()]
    },
  }
}
