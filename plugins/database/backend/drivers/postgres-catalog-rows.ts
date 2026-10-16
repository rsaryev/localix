// PostgreSQL introspection over information_schema + pg_catalog, mapped onto the
// dialect-agnostic schema shape. Pure with respect to the connection: catalog
// queries run through the driver's RowsExecutor.
import type {
  DbPostgresOption,
  DbPostgresPrivilegeGrant,
  DbPostgresSequencePrivilege,
  DbPostgresTablePrivilege,
} from './port'

// The shapes this driver's catalog queries come back as, and the two mappings every grant
// answer needs. Split from `postgres-introspect.ts` (1,637 lines): the queries produce these and
// the assembly consumes them, so neither half owns the declaration.

export interface PgColumnRow {
  column_name: string
  data_type: string
  comment?: string | null
  is_nullable: string
  column_default: string | null
  is_local?: boolean
  generated_kind?: string | null
  generated_expression?: string | null
  identity_kind?: string | null
  sequence_schema?: string | null
  sequence_name?: string | null
  sequence_data_type?: string | null
  sequence_start?: string | null
  sequence_increment?: string | null
  sequence_min?: string | null
  sequence_max?: string | null
  sequence_cache?: string | null
  sequence_cycle?: boolean | null
  sequence_unlogged?: boolean | null
  sequence_comment?: string | null
  sequence_owner?: string | null
  sequence_acl_explicit?: boolean | null
  collation_schema?: string | null
  collation_name?: string | null
  storage_kind?: string | null
  compression_method?: string | null
  statistics_target?: string | number | null
  attribute_options?: string[] | null
}

export interface PgPartitionRow {
  parent_schema: string
  parent_table: string
  partition_bound: string | null
}

export interface PgPartitionColumnRow {
  column_name: string
  child_default: string | null
  parent_default: string | null
  child_not_null: boolean
  parent_not_null: boolean
}

export interface PgInheritanceParentRow {
  parent_schema: string
  parent_table: string
}

export interface PgForeignTableRow {
  server_name: string
  table_options: string[] | null
}

export interface PgForeignColumnRow {
  column_name: string
  column_options: string[] | null
}

export interface PgPolicyRow {
  policy_name: string
  command_kind: string
  permissive: boolean
  roles: string[]
  using_expression: string | null
  check_expression: string | null
}

export interface PgPrivilegeRow {
  column_name: string | null
  grantor: string | null
  grantee: string | null
  is_public: boolean | null
  privilege_type: string | null
  is_grantable: boolean | null
}

export interface PgSequencePrivilegeRow extends PgPrivilegeRow {
  sequence_schema: string
  sequence_name: string
}

export interface PgExtendedStatisticRow {
  statistics_schema: string
  statistics_name: string
  create_script: string
  owner_name: string
  statistics_target: string | number | null
  comment: string | null
}

export const postgresTablePrivileges: ReadonlySet<DbPostgresTablePrivilege> = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
])
export const postgresSequencePrivileges: ReadonlySet<DbPostgresSequencePrivilege> = new Set([
  'USAGE',
  'SELECT',
  'UPDATE',
])

export function postgresGrantFromRow<TPrivilege extends string>(
  row: PgPrivilegeRow,
  privileges: ReadonlySet<TPrivilege>,
): DbPostgresPrivilegeGrant<TPrivilege> | undefined {
  if (
    !row.grantor ||
    !row.privilege_type ||
    !privileges.has(row.privilege_type as TPrivilege) ||
    (!row.is_public && !row.grantee)
  )
    return undefined
  return {
    grantor: row.grantor,
    ...(row.is_public ? {} : { grantee: row.grantee! }),
    privilege: row.privilege_type as TPrivilege,
    grantable: Boolean(row.is_grantable),
  }
}

export function postgresOptions(options: string[] | null | undefined): DbPostgresOption[] {
  return (options ?? []).flatMap((option) => {
    const separator = option.indexOf('=')
    return separator > 0
      ? [{ name: option.slice(0, separator), value: option.slice(separator + 1) }]
      : []
  })
}
