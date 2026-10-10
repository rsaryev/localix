// PostgreSQL introspection over information_schema + pg_catalog, mapped onto the
// dialect-agnostic schema shape. Pure with respect to the connection: catalog
// queries run through the driver's RowsExecutor.
import type {
  DbCheckConstraint,
  DbExclusionConstraint,
  DbKeyConstraint,
  DbPostgresExtendedStatistic,
  DbSchemas,
  DbTableSchema,
} from './port'
import { groupIndexRows } from './index-rows'
import {
  groupForeignKeyRows,
  normalizeForeignKeyMatch,
  normalizeReferentialAction,
  type RowsExecutor,
} from './fk-rows'
import { recordArray } from '../../shared/safe-record'
import { postgresRelationScripts } from './postgres-relation-scripts'
import { postgresColumnSchema } from './postgres-column-schema'
import { postgresOptions } from './postgres-catalog-rows'
import { postgresAccessSchema, postgresRowSecuritySchema } from './postgres-security-schema'
import { postgresInheritanceSchema } from './postgres-inheritance-schema'
import { readPgTableCatalog } from './postgres-table-queries'
export async function pgSchemas(rows: RowsExecutor): Promise<DbSchemas> {
  const items = await rows<{ table_schema: string; table_name: string; table_type: string }>(
    `SELECT table_schema, table_name, table_type
     FROM (
       SELECT table_schema::text, table_name::text, table_type::text
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       UNION ALL
       SELECT n.nspname::text AS table_schema, c.relname::text AS table_name,
              'MATERIALIZED VIEW' AS table_type
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'm'
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND (
           has_table_privilege(c.oid, 'SELECT')
           OR has_any_column_privilege(c.oid, 'SELECT')
         )
     ) AS relations
     ORDER BY table_schema, table_name`,
  )
  const out: DbSchemas = {}
  for (const it of items) {
    recordArray(out, it.table_schema).push({
      name: it.table_name,
      type: it.table_type === 'VIEW' || it.table_type === 'MATERIALIZED VIEW' ? 'view' : 'table',
    })
  }
  return out
}

export async function pgTableSchema(
  rows: RowsExecutor,
  sch: string,
  table: string,
): Promise<DbTableSchema> {
  const {
    colRows,
    keyRows,
    fkRows,
    checkRows,
    idxRows,
    triggerRows,
    ruleRows,
    policyRows,
    privilegeRows,
    sequencePrivilegeRows,
    extendedStatisticRows,
    statRows,
    foreignTableRows,
    foreignColumnRows,
    partitionKeyRows,
    partitionRows,
    partitionColumnRows,
    inheritanceRows,
    inheritanceColumnRows,
    definitionRows,
  } = await readPgTableCatalog(rows, sch, table)
  const relationRow = statRows[0]
  const primaryKey = keyRows.flatMap((row) =>
    row.constraint_type === 'p' && !row.is_included ? [row.column_name] : [],
  )
  const pk = new Set(primaryKey)
  const columns = postgresColumnSchema(
    colRows,
    checkRows,
    foreignColumnRows,
    sequencePrivilegeRows,
    relationRow,
    pk,
  )
  const foreignKeys = groupForeignKeyRows(
    fkRows.map((row) => ({
      id: row.constraint_name,
      column: row.column_name,
      refSchema: row.ref_schema,
      refTable: row.ref_table,
      refColumn: row.ref_column,
      onUpdate: normalizeReferentialAction(row.update_action),
      onDelete: normalizeReferentialAction(row.delete_action),
      match: normalizeForeignKeyMatch(row.match_type),
      deferrable: Boolean(row.is_deferrable),
      initiallyDeferred: Boolean(row.initially_deferred),
      validated: Boolean(row.is_validated),
      onDeleteColumns: row.delete_action_columns ?? [],
      period: Boolean(row.is_period),
      enforced: row.is_enforced === undefined ? undefined : Boolean(row.is_enforced),
      inherited: Boolean(row.is_inherited),
    })),
  )
  const checkConstraints: DbCheckConstraint[] = checkRows.flatMap((row) =>
    row.constraint_type === 'c' && row.expression
      ? [
          {
            name: row.constraint_name,
            expression: row.expression,
            validated: Boolean(row.is_validated),
            noInherit: Boolean(row.no_inherit) || undefined,
            enforced: Boolean(row.is_enforced),
            ...(row.is_inherited ? { inherited: true } : {}),
          },
        ]
      : [],
  )
  const exclusionConstraints: DbExclusionConstraint[] = checkRows.flatMap((row) =>
    row.constraint_type === 'x' && row.exclusion_definition
      ? [
          {
            name: row.constraint_name,
            definition: row.exclusion_definition,
            ...(row.is_inherited ? { inherited: true } : {}),
          },
        ]
      : [],
  )
  const keyConstraintsByName = new Map<string, DbKeyConstraint>()
  for (const row of keyRows) {
    let constraint = keyConstraintsByName.get(row.constraint_name)
    if (!constraint) {
      constraint = {
        name: row.constraint_name,
        type: row.constraint_type === 'p' ? 'PRIMARY KEY' : 'UNIQUE',
        columns: [],
        ...(row.nulls_not_distinct ? { nullsNotDistinct: true } : {}),
        ...(row.is_deferrable ? { deferrable: true } : {}),
        ...(row.initially_deferred ? { initiallyDeferred: true } : {}),
        ...(row.without_overlaps ? { withoutOverlaps: true } : {}),
        ...(row.is_inherited ? { inherited: true } : {}),
      }
      keyConstraintsByName.set(row.constraint_name, constraint)
    }
    if (row.is_included) (constraint.includeColumns ??= []).push(row.column_name)
    else constraint.columns.push(row.column_name)
  }
  const keyConstraints = [...keyConstraintsByName.values()]
  const indexes = groupIndexRows(
    idxRows.map((row) => ({
      name: row.index_name,
      column: row.column_name ?? row.column_definition,
      seq: Number(row.ord),
      unique: row.is_unique,
      primary: row.is_primary,
      constraint: row.is_constraint,
      included: row.is_included,
      createScript: row.create_script,
      createScriptOnly: row.create_script_only,
      inherited: row.is_inherited,
    })),
  )
  const reltuples = statRows.length > 0 ? Number(statRows[0].reltuples) : Number.NaN
  const approxRows = Number.isFinite(reltuples) && reltuples >= 0 ? reltuples : undefined
  const persistence: NonNullable<DbTableSchema['postgresRelation']>['persistence'] =
    relationRow?.persistence === 'u'
      ? 'UNLOGGED'
      : relationRow?.persistence === 't'
        ? 'TEMPORARY'
        : undefined
  const storageParameters = relationRow?.storage_parameters?.filter(Boolean)
  const postgresRelation =
    persistence ||
    relationRow?.access_method ||
    storageParameters?.length ||
    relationRow?.tablespace
      ? {
          ...(persistence ? { persistence } : {}),
          ...(relationRow?.access_method ? { accessMethod: relationRow.access_method } : {}),
          ...(storageParameters?.length ? { storageParameters } : {}),
          ...(relationRow?.tablespace ? { tablespace: relationRow.tablespace } : {}),
        }
      : undefined
  const postgresOfType =
    relationRow?.of_type_schema && relationRow.of_type_name
      ? { schema: relationRow.of_type_schema, name: relationRow.of_type_name }
      : undefined
  const foreignTableRow = foreignTableRows[0]
  const foreignTableOptions = postgresOptions(foreignTableRow?.table_options)
  const postgresForeign = foreignTableRow
    ? {
        server: foreignTableRow.server_name,
        ...(foreignTableOptions.length ? { options: foreignTableOptions } : {}),
      }
    : undefined
  const postgresRowSecurity = postgresRowSecuritySchema(policyRows, relationRow)
  const postgresReplicaIdentity =
    relationRow?.replica_identity === 'n'
      ? ({ mode: 'NOTHING' } as const)
      : relationRow?.replica_identity === 'f'
        ? ({ mode: 'FULL' } as const)
        : relationRow?.replica_identity === 'i' && relationRow.replica_identity_index
          ? ({ mode: 'INDEX', index: relationRow.replica_identity_index } as const)
          : relationRow?.replica_identity === 'i'
            ? ({ mode: 'NOTHING' } as const)
            : undefined
  const postgresClusteredIndex = relationRow?.clustered_index?.trim() || undefined
  const postgresAccess = postgresAccessSchema(privilegeRows, relationRow)
  const postgresExtendedStatistics: DbPostgresExtendedStatistic[] =
    extendedStatisticRows?.flatMap((statistic) => {
      const createScript = statistic.create_script.trim()
      if (!createScript) return []
      const statisticsTarget =
        statistic.statistics_target == null ? Number.NaN : Number(statistic.statistics_target)
      return [
        {
          schema: statistic.statistics_schema,
          name: statistic.statistics_name,
          createScript,
          owner: statistic.owner_name,
          ...(Number.isFinite(statisticsTarget) ? { statisticsTarget } : {}),
          ...(statistic.comment ? { comment: statistic.comment } : {}),
        },
      ]
    }) ?? []
  const definitionRow = definitionRows[0]
  const { postgresPartitionBy, postgresPartition, postgresInheritance } = postgresInheritanceSchema(
    partitionKeyRows,
    partitionRows,
    partitionColumnRows,
    inheritanceRows,
    inheritanceColumnRows,
    colRows,
  )
  const { triggers, rules, createScript } = postgresRelationScripts(
    sch,
    table,
    relationRow,
    definitionRow,
    triggerRows,
    ruleRows,
  )

  return {
    schema: sch,
    name: table,
    type: statRows[0]?.relkind === 'v' || statRows[0]?.relkind === 'm' ? 'view' : 'table',
    ...(relationRow?.relation_comment ? { comment: relationRow.relation_comment } : {}),
    columns,
    primaryKey,
    foreignKeys,
    checkConstraints,
    keyConstraints,
    exclusionConstraints,
    ...(postgresPartitionBy ? { postgresPartitionBy } : {}),
    ...(postgresPartition ? { postgresPartition } : {}),
    ...(postgresInheritance ? { postgresInheritance } : {}),
    ...(postgresRelation ? { postgresRelation } : {}),
    ...(postgresOfType ? { postgresOfType } : {}),
    ...(postgresForeign ? { postgresForeign } : {}),
    ...(postgresRowSecurity ? { postgresRowSecurity } : {}),
    ...(postgresReplicaIdentity ? { postgresReplicaIdentity } : {}),
    ...(postgresClusteredIndex ? { postgresClusteredIndex } : {}),
    ...(postgresExtendedStatistics.length ? { postgresExtendedStatistics } : {}),
    ...(postgresAccess ? { postgresAccess } : {}),
    indexes,
    ...(rules.length ? { rules } : {}),
    ...(triggers.length ? { triggers } : {}),
    approxRows,
    createScript,
  }
}
