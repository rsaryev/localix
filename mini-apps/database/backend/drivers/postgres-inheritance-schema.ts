import type { PgPartitionColumnRow } from './postgres-catalog-rows'
import type { readPgTableCatalog } from './postgres-table-queries'

type PgTableCatalog = Awaited<ReturnType<typeof readPgTableCatalog>>

export function postgresInheritanceSchema(
  partitionKeyRows: PgTableCatalog['partitionKeyRows'],
  partitionRows: PgTableCatalog['partitionRows'],
  partitionColumnRows: PgTableCatalog['partitionColumnRows'],
  inheritanceRows: PgTableCatalog['inheritanceRows'],
  inheritanceColumnRows: PgTableCatalog['inheritanceColumnRows'],
  colRows: PgTableCatalog['colRows'],
) {
  const postgresPartitionBy = partitionKeyRows[0]?.partition_key?.trim() || undefined
  const normalizeDefault = (value: string | null | undefined) => value?.trim() || null
  const partitionRow = partitionRows[0]
  const defaultOverrides = partitionColumnRows.flatMap((column) => {
    const childDefault = normalizeDefault(column.child_default)
    const parentDefault = normalizeDefault(column.parent_default)
    return childDefault === parentDefault
      ? []
      : [{ column: column.column_name, value: childDefault }]
  })
  const notNullColumns = partitionColumnRows.flatMap((column) =>
    column.child_not_null && !column.parent_not_null ? [column.column_name] : [],
  )
  const partitionBound = partitionRow?.partition_bound?.trim()
  const postgresPartition =
    partitionRow?.parent_schema && partitionRow.parent_table && partitionBound
      ? {
          parentSchema: partitionRow.parent_schema,
          parentTable: partitionRow.parent_table,
          bound: partitionBound,
          ...(defaultOverrides.length ? { defaultOverrides } : {}),
          ...(notNullColumns.length ? { notNullColumns } : {}),
        }
      : undefined
  const inheritanceColumns = new Map<string, PgPartitionColumnRow[]>()
  for (const column of inheritanceColumnRows) {
    const grouped = inheritanceColumns.get(column.column_name) ?? []
    grouped.push(column)
    inheritanceColumns.set(column.column_name, grouped)
  }
  const inheritanceDefaultOverrides = [...inheritanceColumns].flatMap(([column, parentRows]) => {
    const childDefault = normalizeDefault(parentRows[0]?.child_default)
    return parentRows.some(
      (parentColumn) => normalizeDefault(parentColumn.parent_default) !== childDefault,
    )
      ? [{ column, value: childDefault }]
      : []
  })
  const inheritanceNotNullColumns = [...inheritanceColumns].flatMap(([column, parentRows]) =>
    parentRows[0]?.child_not_null &&
    parentRows.every((parentColumn) => !parentColumn.parent_not_null)
      ? [column]
      : [],
  )
  const postgresInheritance = inheritanceRows.length
    ? {
        parents: inheritanceRows.map((parent) => ({
          schema: parent.parent_schema,
          table: parent.parent_table,
        })),
        localColumns: colRows.flatMap((column) =>
          column.is_local !== false ? [column.column_name] : [],
        ),
        ...(inheritanceDefaultOverrides.length
          ? { defaultOverrides: inheritanceDefaultOverrides }
          : {}),
        ...(inheritanceNotNullColumns.length ? { notNullColumns: inheritanceNotNullColumns } : {}),
      }
    : undefined
  return { postgresPartitionBy, postgresPartition, postgresInheritance }
}
