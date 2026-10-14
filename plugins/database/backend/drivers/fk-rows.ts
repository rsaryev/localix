// Shared introspection seams for the SQL drivers (sibling of index-rows.ts):
// the row-executor shape the pure introspect modules run their catalog queries
// through, and the FK-row grouping every dialect repeats.
import type { DbForeignKey, DbForeignKeyMatch, DbReferentialAction } from './port'

/** Run a catalog query and return name-keyed object rows (each driver's own binding). */
export type RowsExecutor = <T>(text: string, params?: unknown[]) => Promise<T[]>

/** One (constraint, column) pair from a dialect's FK catalog query. */
export interface ForeignKeyRow {
  /** Constraint name — the grouping key for composite FKs. */
  id: string
  column: string
  refSchema: string
  refTable: string
  refColumn: string
  onUpdate?: DbReferentialAction
  onDelete?: DbReferentialAction
  onDeleteColumns?: string[]
  match?: DbForeignKeyMatch
  deferrable?: boolean
  initiallyDeferred?: boolean
  validated?: boolean
  inherited?: boolean
  period?: boolean
  enforced?: boolean
  notForReplication?: boolean
  disabled?: boolean
  notTrusted?: boolean
}

/** Normalize the spellings used by PostgreSQL chars and SQL Server *_ACTION catalog rows. */
export function normalizeReferentialAction(
  value: string | null | undefined,
): DbReferentialAction | undefined {
  switch (value?.trim().toUpperCase().replaceAll('_', ' ')) {
    case 'A':
    case 'NO ACTION':
      return 'NO ACTION'
    case 'R':
    case 'RESTRICT':
      return 'RESTRICT'
    case 'C':
    case 'CASCADE':
      return 'CASCADE'
    case 'N':
    case 'SET NULL':
      return 'SET NULL'
    case 'D':
    case 'SET DEFAULT':
      return 'SET DEFAULT'
    case undefined:
    default:
      return undefined
  }
}

/** Normalize PostgreSQL's one-character pg_constraint match mode. */
export function normalizeForeignKeyMatch(
  value: string | null | undefined,
): DbForeignKeyMatch | undefined {
  switch (value?.trim().toUpperCase()) {
    case 'S':
    case 'SIMPLE':
      return 'SIMPLE'
    case 'F':
    case 'FULL':
      return 'FULL'
    case 'P':
    case 'PARTIAL':
      return 'PARTIAL'
    case undefined:
    default:
      return undefined
  }
}

/**
 * Group per-column FK catalog rows into composite {@link DbForeignKey}s by constraint
 * name, preserving row order within each constraint (the catalog queries order by
 * ordinal position where it matters).
 */
export function groupForeignKeyRows(rows: ForeignKeyRow[]): DbForeignKey[] {
  const fkById = new Map<string, DbForeignKey>()
  for (const r of rows) {
    const existing = fkById.get(r.id)
    if (existing) {
      existing.columns.push(r.column)
      existing.refColumns.push(r.refColumn)
    } else {
      fkById.set(r.id, {
        name: r.id,
        columns: [r.column],
        refSchema: r.refSchema,
        refTable: r.refTable,
        refColumns: [r.refColumn],
        ...(r.onUpdate ? { onUpdate: r.onUpdate } : {}),
        ...(r.onDelete ? { onDelete: r.onDelete } : {}),
        ...(r.onDeleteColumns?.length ? { onDeleteColumns: r.onDeleteColumns } : {}),
        ...(r.match ? { match: r.match } : {}),
        ...(r.deferrable !== undefined ? { deferrable: r.deferrable } : {}),
        ...(r.initiallyDeferred !== undefined ? { initiallyDeferred: r.initiallyDeferred } : {}),
        ...(r.validated !== undefined ? { validated: r.validated } : {}),
        ...(r.inherited ? { inherited: true } : {}),
        ...(r.period ? { period: true } : {}),
        ...(r.enforced !== undefined ? { enforced: r.enforced } : {}),
        ...(r.notForReplication !== undefined ? { notForReplication: r.notForReplication } : {}),
        ...(r.disabled !== undefined ? { disabled: r.disabled } : {}),
        ...(r.notTrusted !== undefined ? { notTrusted: r.notTrusted } : {}),
      })
    }
  }
  return [...fkById.values()]
}
