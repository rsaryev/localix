/**
 * @localixai/dataview — agnostic tabular data-view core.
 * Table model + chart specs + parse + query (sort/filter/page) + summarize +
 * format-export registry + native open-with catalog. No React, no DOM, no Node.
 */

export * from './model'
export * from './chart'
export * from './parse'
export * from './query'
export * from './summarize'
export * from './export/registry'
export * from './export/csv'
export * from './export/xlsx'
export * from './open/targets'

import { csvExporter } from './export/csv'
import { xlsxExporter } from './export/xlsx'
import { createExporterRegistry, type ExporterRegistry } from './export/registry'

/**
 * Default registry with the built-in exporters. CSV serializes here; XLSX is a
 * DECLARATION only (the host registers real SheetJS bytes over it — see
 * `export/xlsx.ts`), so both formats appear in the shared export menu.
 */
export function createDefaultExporterRegistry(): ExporterRegistry {
  return createExporterRegistry([csvExporter, xlsxExporter])
}
