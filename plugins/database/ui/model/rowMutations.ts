// Pure builders for single-row UPDATE / DELETE / INSERT, targeting a table by its
// primary key. Executed mutations keep values in driver parameters; the INSERT text
// builders inline escaped SQL literals (see sqlLiteral). Requires a non-empty primary key
// for UPDATE/DELETE so a row is addressed unambiguously. Framework-free + unit-tested.
import type { DbDialect } from '../dbClient'
import { coerceCell, type TableCellType, type TableCellValue } from '@localixai/dataview'
import { quoteIdent } from './sqlIdent'
import { sqlLiteral } from './sqlLiteral'
import { defineRecordValue, ownRecordValue } from '../../shared/safe-record'

export interface MutationTarget {
  table: string
  schema?: string
  dialect: DbDialect
  /** Primary-key column names (real names). Required for UPDATE/DELETE. */
  pk: string[]
}

/** A mutation target paired with result-column provenance. Optional so plain table rows
 * continue to address columns by their displayed physical names. */
export interface ResultMutationTarget extends MutationTarget {
  /** Grid result-column id → physical source column. Missing ids are non-source expressions. */
  sourceColumnById?: Record<string, string>
  /** Per-column mutation/export gate for inferred query results. */
  editableColumnIds?: Set<string>
}

export interface BoundMutationStatement {
  sql: string
  params: unknown[]
}

/**
 * Parse text typed into an editable database cell without silently changing its meaning.
 * The generic dataview coercer uses null as its invalid/blank sentinel, but this editor has
 * a dedicated NULL action: blank text must stay blank, invalid values must stop Commit, and
 * integers outside Number's exact range must stay strings for native driver binding.
 */
export function coerceMutationCell(raw: string, type: TableCellType): TableCellValue {
  if (type === 'text' || type === 'date') return raw

  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error(`A blank value is not a valid ${type}`)

  if (type === 'int') {
    const number = Number(trimmed)
    if (!Number.isFinite(number) || !Number.isInteger(number)) {
      throw new Error(`"${raw}" is not a valid integer`)
    }
    return Number.isSafeInteger(number) ? number : trimmed
  }

  const value = coerceCell(trimmed, type)
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`"${raw}" is not a valid ${type} value`)
  }
  return value
}

/**
 * A browsed single-table target that the console can edit inline: a {@link MutationTarget}
 * plus the connection it runs against and a callback to re-run the SELECT after a commit.
 * (Formerly declared in the now-removed RowEditorDrawer — editing is fully inline.)
 */
export interface RowEditTarget extends ResultMutationTarget {
  connectionId: string
  onCommitted: () => void
}

/** `schema.table` (both quoted) when a schema is given, else just the table. Takes only the
 *  three fields it reads, so any caller naming a table — not just a mutation target — can
 *  reach it instead of re-deriving the rule. */
export function qualifiedTable(t: Pick<MutationTarget, 'table' | 'schema' | 'dialect'>): string {
  const table = quoteIdent(t.table, t.dialect)
  return t.schema ? `${quoteIdent(t.schema, t.dialect)}.${table}` : table
}

function bindValue(t: MutationTarget, params: unknown[], value: unknown): string {
  params.push(value)
  return t.dialect === 'postgres' ? `$${params.length}` : '?'
}

function boundWhereByPk(
  t: MutationTarget,
  keyValues: Record<string, unknown>,
  params: unknown[],
): string {
  return t.pk
    .map((col) => {
      const lhs = quoteIdent(col, t.dialect)
      const value = ownRecordValue(keyValues, col)
      // `col = NULL` is always false in SQL, so a null key value would make the UPDATE/DELETE
      // silently match zero rows. Use `IS NULL` so the row is still addressed. (Real PK columns
      // are non-null, but introspected "PKs" on views / engines without enforced keys can slip.)
      return value === null || value === undefined
        ? `${lhs} IS NULL`
        : `${lhs} = ${bindValue(t, params, value)}`
    })
    .join(' AND ')
}

/** Parameterized UPDATE for execution: no cell value is interpolated into executable SQL. */
export function buildBoundUpdate(
  t: MutationTarget,
  changes: Record<string, unknown>,
  keyValues: Record<string, unknown>,
): BoundMutationStatement {
  if (t.pk.length === 0) throw new Error('Cannot update a row without a primary key')
  const cols = Object.keys(changes)
  if (cols.length === 0) throw new Error('No changes to update')
  const params: unknown[] = []
  const set = cols
    .map((col) => `${quoteIdent(col, t.dialect)} = ${bindValue(t, params, changes[col])}`)
    .join(', ')
  const where = boundWhereByPk(t, keyValues, params)
  return { sql: `UPDATE ${qualifiedTable(t)} SET ${set} WHERE ${where};`, params }
}

/** Parameterized DELETE for execution. */
export function buildBoundDelete(
  t: MutationTarget,
  keyValues: Record<string, unknown>,
): BoundMutationStatement {
  if (t.pk.length === 0) throw new Error('Cannot delete a row without a primary key')
  const params: unknown[] = []
  const where = boundWhereByPk(t, keyValues, params)
  return { sql: `DELETE FROM ${qualifiedTable(t)} WHERE ${where};`, params }
}

/** INSERT a new row from `values` (col → value); columns with an undefined value are omitted. */
export function buildInsert(t: MutationTarget, values: Record<string, unknown>): string {
  const cols = Object.keys(values).filter((c) => values[c] !== undefined)
  if (cols.length === 0) throw new Error('No values to insert')
  const colList = cols.map((c) => quoteIdent(c, t.dialect)).join(', ')
  const valList = cols.map((c) => sqlLiteral(values[c], t.dialect)).join(', ')
  return `INSERT INTO ${qualifiedTable(t)} (${colList}) VALUES (${valList});`
}

/** Parameterized INSERT for execution. An empty record inserts one all-default row. */
export function buildBoundInsert(
  t: MutationTarget,
  values: Record<string, unknown>,
): BoundMutationStatement {
  const cols = Object.keys(values).filter((col) => values[col] !== undefined)
  if (cols.length === 0) {
    // MySQL does not implement the standard DEFAULT VALUES form. Its empty column/value
    // lists are the documented equivalent; the other editable SQL engines accept the
    // standard form.
    const sql =
      t.dialect === 'mysql'
        ? `INSERT INTO ${qualifiedTable(t)} () VALUES ();`
        : `INSERT INTO ${qualifiedTable(t)} DEFAULT VALUES;`
    return { sql, params: [] }
  }
  const params: unknown[] = []
  const colList = cols.map((col) => quoteIdent(col, t.dialect)).join(', ')
  const valList = cols.map((col) => bindValue(t, params, values[col])).join(', ')
  return {
    sql: `INSERT INTO ${qualifiedTable(t)} (${colList}) VALUES (${valList});`,
    params,
  }
}

/**
 * Generate one INSERT per result row for a known table target — data export as seed SQL.
 * Columns are addressed by their real DB name (the grid column title); a missing cell
 * becomes NULL so every INSERT lists the full column set.
 */
export function buildInsertsFromRows(
  t: ResultMutationTarget,
  columns: ReadonlyArray<{ id: string; title: string }>,
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  return rows
    .map((row) => {
      const record: Record<string, unknown> = {}
      for (const col of columns) {
        if (t.editableColumnIds && !t.editableColumnIds.has(col.id)) continue
        // Once provenance exists, a missing id is a computed/ambiguous expression and
        // must not leak into INSERT as its result alias.
        const source = t.sourceColumnById ? ownRecordValue(t.sourceColumnById, col.id) : col.title
        if (source) defineRecordValue(record, source, ownRecordValue(row, col.id) ?? null)
      }
      return buildInsert(t, record)
    })
    .join('\n')
}
