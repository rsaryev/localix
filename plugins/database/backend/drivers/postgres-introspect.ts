// PostgreSQL introspection over information_schema + pg_catalog, mapped onto the
// dialect-agnostic schema shape. Pure with respect to the connection: catalog
// queries run through the driver's RowsExecutor.
import type {
  DbCheckConstraint,
  DbColumn,
  DbExclusionConstraint,
  DbKeyConstraint,
  DbPostgresPolicy,
  DbPostgresExtendedStatistic,
  DbPostgresPrivilegeGrant,
  DbPostgresSequencePrivilege,
  DbSchemas,
  DbSequenceDefinition,
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
import {
  postgresGrantFromRow,
  postgresOptions,
  postgresSequencePrivileges,
  postgresTablePrivileges,
} from './postgres-catalog-rows'
import type { PgPartitionColumnRow } from './postgres-catalog-rows'
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
  const notNullByColumn = new Map(
    checkRows.flatMap((constraint) =>
      constraint.constraint_type === 'n' && constraint.column_name
        ? [
            [
              constraint.column_name,
              {
                name: constraint.constraint_name,
                validated: Boolean(constraint.is_validated),
                ...(constraint.no_inherit ? { noInherit: true } : {}),
                ...(constraint.is_inherited ? { inherited: true } : {}),
              },
            ] as const,
          ]
        : [],
    ),
  )
  const foreignOptionsByColumn = new Map(
    foreignColumnRows.map((column) => [column.column_name, postgresOptions(column.column_options)]),
  )
  const sequenceGrantsByName = new Map<
    string,
    Array<DbPostgresPrivilegeGrant<DbPostgresSequencePrivilege>>
  >()
  for (const row of sequencePrivilegeRows ?? []) {
    const key = `${row.sequence_schema}\u0000${row.sequence_name}`
    const grants = sequenceGrantsByName.get(key) ?? []
    const grant = postgresGrantFromRow(row, postgresSequencePrivileges)
    if (grant) grants.push(grant)
    sequenceGrantsByName.set(key, grants)
  }
  const columns: DbColumn[] = colRows.map((column) => {
    const sequenceGrants =
      column.sequence_schema && column.sequence_name
        ? sequenceGrantsByName.get(`${column.sequence_schema}\u0000${column.sequence_name}`)
        : undefined
    const sequence: DbSequenceDefinition | undefined =
      column.sequence_schema &&
      column.sequence_name &&
      column.sequence_data_type &&
      column.sequence_start &&
      column.sequence_increment &&
      column.sequence_min &&
      column.sequence_max &&
      column.sequence_cache
        ? {
            schema: column.sequence_schema,
            name: column.sequence_name,
            dataType: column.sequence_data_type,
            start: column.sequence_start,
            increment: column.sequence_increment,
            minValue: column.sequence_min,
            maxValue: column.sequence_max,
            cache: column.sequence_cache,
            cycle: Boolean(column.sequence_cycle),
            ...(relationRow?.persistence === 'u' && column.sequence_unlogged === false
              ? { logged: true }
              : {}),
            ...(column.sequence_unlogged ? { unlogged: true } : {}),
            ...(column.sequence_comment ? { comment: column.sequence_comment } : {}),
            ...(column.sequence_owner
              ? {
                  postgresAccess: {
                    owner: column.sequence_owner,
                    ...(column.sequence_acl_explicit && sequencePrivilegeRows !== undefined
                      ? { grants: sequenceGrants ?? [] }
                      : {}),
                  },
                }
              : {}),
          }
        : undefined
    const identityGeneration =
      column.identity_kind === 'a'
        ? 'ALWAYS'
        : column.identity_kind === 'd'
          ? 'BY DEFAULT'
          : undefined
    const generatedStorage =
      column.generated_kind === 's'
        ? 'STORED'
        : column.generated_kind === 'v'
          ? 'VIRTUAL'
          : undefined
    const postgresStorage: DbColumn['postgresStorage'] =
      column.storage_kind === 'PLAIN' ||
      column.storage_kind === 'EXTERNAL' ||
      column.storage_kind === 'EXTENDED' ||
      column.storage_kind === 'MAIN'
        ? column.storage_kind
        : undefined
    const postgresCompression: DbColumn['postgresCompression'] =
      column.compression_method === 'pglz' || column.compression_method === 'lz4'
        ? column.compression_method
        : undefined
    const statisticsTarget =
      column.statistics_target == null ? Number.NaN : Number(column.statistics_target)
    const postgresAttributeOptions = postgresOptions(column.attribute_options)
    return {
      name: column.column_name,
      dataType: column.data_type,
      nullable: column.is_nullable === 'YES',
      pk: pk.has(column.column_name),
      defaultValue: column.column_default,
      ...(column.comment ? { comment: column.comment } : {}),
      ...(generatedStorage && column.generated_expression
        ? {
            generated: {
              expression: column.generated_expression,
              storage: generatedStorage,
            },
          }
        : {}),
      ...(identityGeneration
        ? {
            identity: {
              generation: identityGeneration,
              ...(sequence ? { sequence } : {}),
            },
          }
        : {}),
      ...(!identityGeneration && sequence && /\bnextval\s*\(/iu.test(column.column_default ?? '')
        ? { ownedSequence: sequence }
        : {}),
      ...(notNullByColumn.has(column.column_name)
        ? { postgresNotNull: notNullByColumn.get(column.column_name)! }
        : {}),
      ...(foreignOptionsByColumn.get(column.column_name)?.length
        ? { postgresForeignOptions: foreignOptionsByColumn.get(column.column_name)! }
        : {}),
      ...(column.collation_schema && column.collation_name
        ? {
            postgresCollation: {
              schema: column.collation_schema,
              name: column.collation_name,
            },
          }
        : {}),
      ...(postgresStorage ? { postgresStorage } : {}),
      ...(postgresCompression ? { postgresCompression } : {}),
      ...(Number.isFinite(statisticsTarget) ? { postgresStatistics: statisticsTarget } : {}),
      ...(postgresAttributeOptions.length ? { postgresAttributeOptions } : {}),
    }
  })
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
  const policies: DbPostgresPolicy[] = policyRows.flatMap((policy) => {
    const command =
      policy.command_kind === 'ALL' ||
      policy.command_kind === 'SELECT' ||
      policy.command_kind === 'INSERT' ||
      policy.command_kind === 'UPDATE' ||
      policy.command_kind === 'DELETE'
        ? policy.command_kind
        : undefined
    if (!command) return []
    const usingExpression = policy.using_expression?.trim()
    const checkExpression = policy.check_expression?.trim()
    return [
      {
        name: policy.policy_name,
        command,
        permissive: policy.permissive ?? true,
        roles: policy.roles?.length ? policy.roles : ['PUBLIC'],
        ...(usingExpression ? { using: usingExpression } : {}),
        ...(checkExpression ? { withCheck: checkExpression } : {}),
      },
    ]
  })
  const postgresRowSecurity =
    relationRow?.row_security || relationRow?.force_row_security || policies.length
      ? {
          enabled: Boolean(relationRow?.row_security),
          forced: Boolean(relationRow?.force_row_security),
          policies,
        }
      : undefined
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
  const postgresAccess =
    relationRow?.owner_name && privilegeRows !== undefined
      ? {
          owner: relationRow.owner_name,
          ...(relationRow.acl_explicit
            ? {
                tableGrants: privilegeRows.flatMap((row) => {
                  if (row.column_name !== null) return []
                  const grant = postgresGrantFromRow(row, postgresTablePrivileges)
                  return grant ? [grant] : []
                }),
              }
            : {}),
          ...(() => {
            const columnGrants = new Map<string, DbPostgresPrivilegeGrant[]>()
            for (const row of privilegeRows) {
              if (row.column_name === null) continue
              const grants = columnGrants.get(row.column_name) ?? []
              const grant = postgresGrantFromRow(row, postgresTablePrivileges)
              if (grant) grants.push(grant)
              columnGrants.set(row.column_name, grants)
            }
            return columnGrants.size
              ? {
                  columnGrants: [...columnGrants].map(([column, grants]) => ({
                    column,
                    grants,
                  })),
                }
              : {}
          })(),
        }
      : relationRow?.owner_name
        ? { owner: relationRow.owner_name }
        : undefined
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
