import { useEffect, useMemo } from 'react'
import type { DbDialect } from '../dbClient'
import { DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'
import { analyzeEditableSelect } from '../model/editableSelect'
import { mapEditableResult } from '../model/editableResult'
import type { useSchema } from '../model/useSchema'
import type { SqlConsoleState } from '../model/useSqlConsole'
import type { RowEditTarget } from '../model/rowMutations'

export interface BrowseTarget {
  table: string
  schema?: string
}

function resolveTarget(
  parsed: ReturnType<typeof analyzeEditableSelect>,
  browse: BrowseTarget | null,
  schemas: ReturnType<typeof useSchema>['schemas'],
): BrowseTarget | null {
  if (browse) return browse
  if (!parsed) return null
  if (parsed.schema) return { table: parsed.table, schema: parsed.schema }

  const groups = Object.entries(schemas ?? {})
  const matches = groups.flatMap(([schemaName, items]) =>
    items.flatMap((item) =>
      item.type === 'table' && item.name.toLowerCase() === parsed.table.toLowerCase()
        ? [
            {
              table: item.name,
              // Single-namespace drivers cache/fetch their objects without an explicit schema.
              schema: groups.length === 1 ? undefined : schemaName,
            },
          ]
        : [],
    ),
  )
  return matches.length === 1 ? matches[0]! : { table: parsed.table }
}

/**
 * Query-result row editing goes through a provenance gate: resolve one physical table,
 * introspect it, map direct result columns back to source columns, and require the
 * complete primary key in every result row.
 *
 * A filtered query such as `SELECT * FROM users WHERE id = 1` therefore remains editable.
 * Joins, aggregates, subqueries, set operations and ambiguous same-named tables do not.
 */
export function useRowEditGate({
  readonly,
  browse,
  activeSql,
  active,
  schema,
  consoleState,
  dialect,
  connectionId,
}: {
  readonly: boolean
  browse: BrowseTarget | null
  activeSql: string
  active: SqlConsoleState['active']
  schema: ReturnType<typeof useSchema>
  consoleState: SqlConsoleState
  dialect: DbDialect
  connectionId: string
}) {
  const manifest = DATABASE_DRIVER_CATALOG[dialect]
  const { getTable, loadTable, schemas } = schema
  const parsed = useMemo(() => analyzeEditableSelect(activeSql, dialect), [activeSql, dialect])
  const target = useMemo(() => resolveTarget(parsed, browse, schemas), [browse, parsed, schemas])

  // Table metadata remains lazy. An ad-hoc SELECT now requests the same shared cache
  // used by the object browser; no query-specific introspection path is introduced.
  useEffect(() => {
    if (!readonly && manifest.capabilities.rowEditing && target)
      loadTable(target.table, target.schema)
  }, [loadTable, manifest.capabilities.rowEditing, readonly, target])

  const table = target ? getTable(target.table, target.schema) : undefined
  const resultColumns = active?.kind === 'result' ? active.outcome?.result?.columns : undefined
  const provenance = useMemo(() => {
    if (!table || !resultColumns || !target) return null
    // Browse tabs are created by our own table browser. For ad-hoc results, the parser
    // must independently prove the same one-table source.
    const analysis =
      parsed ??
      (browse ? { table: target.table, schema: target.schema, wildcard: true, columns: {} } : null)
    return analysis ? mapEditableResult(analysis, table, resultColumns) : null
  }, [browse, parsed, resultColumns, table, target])

  const editTarget: RowEditTarget | undefined = useMemo(() => {
    if (readonly || !manifest.capabilities.rowEditing || !target || !table || !provenance)
      return undefined
    return {
      connectionId,
      table: table.name,
      schema: table.schema ?? target.schema,
      dialect,
      pk: table.primaryKey,
      sourceColumnById: provenance.sourceColumnById,
      editableColumnIds: provenance.editableColumnIds,
      onCommitted: () => void consoleState.refreshActive(),
    }
  }, [
    connectionId,
    consoleState,
    dialect,
    manifest.capabilities.rowEditing,
    provenance,
    readonly,
    table,
    target,
  ])

  // FK navigation remains limited to browse tabs: ad-hoc result aliases would require
  // carrying source-column metadata into the navigation filter builder as well.
  const fkLinks = useMemo(() => {
    if (!editTarget || !browse || !table) return undefined
    const fks = table.foreignKeys.filter((fk) => fk.columns.length === 1)
    const cols = active?.outcome?.result?.columns ?? []
    const bySource = new Map(
      cols.flatMap((column) => {
        const source = editTarget.sourceColumnById?.[column.id] ?? column.title
        return source ? [[source, column.id] as const] : []
      }),
    )
    const map = new Map<string, { refSchema?: string; refTable: string; refColumn: string }>()
    for (const fk of fks) {
      const id = bySource.get(fk.columns[0]!)
      if (id)
        map.set(id, {
          refSchema: fk.refSchema,
          refTable: fk.refTable,
          refColumn: fk.refColumns[0]!,
        })
    }
    return map.size > 0 ? map : undefined
  }, [active, browse, editTarget, table])

  const linkColumns = useMemo(() => (fkLinks ? new Set(fkLinks.keys()) : undefined), [fkLinks])

  return { editTarget, fkLinks, linkColumns }
}
