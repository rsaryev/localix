// SQL-specific clipboard builder for a single result row: one INSERT for a known editable
// table. Framework-free + unit-tested. Reuses the row-mutation SQL builder
// (buildInsertsFromRows) so INSERT generation lives in ONE place. The generic row-copy
// helpers (JSON / cell text) live in `@localixai/mini-app-sdk/ui/table` — shared with the core grid.
import type { TableCopyColumn } from '@localixai/mini-app-sdk/ui/table'
import type { TableRow } from '@localixai/dataview'
import { buildInsertsFromRows, type MutationTarget } from './rowMutations'
import { adaptedRowsToRecords, type AdaptedResult } from './resultAdapter'

// Re-exported so a consumer can depend on this one module for the INSERT copy + its target.
export type { MutationTarget } from './rowMutations'

/**
 * One result row as a single INSERT for a known editable table, via the shared row-mutation
 * builder (columns addressed by their real name = the column title, a missing cell → NULL).
 */
export function rowToInsert(
  target: MutationTarget,
  columns: ReadonlyArray<TableCopyColumn>,
  row: TableRow,
  result?: AdaptedResult,
): string {
  return buildInsertsFromRows(target, columns, result ? adaptedRowsToRecords(result, [row]) : [row])
}
