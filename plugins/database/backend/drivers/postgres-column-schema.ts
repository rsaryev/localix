import type {
  DbColumn,
  DbSequenceDefinition,
  DbPostgresPrivilegeGrant,
  DbPostgresSequencePrivilege,
} from './port'
import {
  postgresOptions,
  postgresGrantFromRow,
  postgresSequencePrivileges,
} from './postgres-catalog-rows'
import type { readPgTableCatalog } from './postgres-table-queries'

type PgTableCatalog = Awaited<ReturnType<typeof readPgTableCatalog>>

export function postgresColumnSchema(
  colRows: PgTableCatalog['colRows'],
  checkRows: PgTableCatalog['checkRows'],
  foreignColumnRows: PgTableCatalog['foreignColumnRows'],
  sequencePrivilegeRows: PgTableCatalog['sequencePrivilegeRows'],
  relationRow: PgTableCatalog['statRows'][number] | undefined,
  pk: ReadonlySet<string>,
): DbColumn[] {
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
  return columns
}
