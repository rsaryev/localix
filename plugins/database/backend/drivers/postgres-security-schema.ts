import type { DbPostgresPolicy, DbPostgresPrivilegeGrant } from './port'
import { postgresGrantFromRow, postgresTablePrivileges } from './postgres-catalog-rows'
import type { readPgTableCatalog } from './postgres-table-queries'

type PgTableCatalog = Awaited<ReturnType<typeof readPgTableCatalog>>

export function postgresRowSecuritySchema(
  policyRows: PgTableCatalog['policyRows'],
  relationRow: PgTableCatalog['statRows'][number] | undefined,
) {
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
  return postgresRowSecurity
}

export function postgresAccessSchema(
  privilegeRows: PgTableCatalog['privilegeRows'],
  relationRow: PgTableCatalog['statRows'][number] | undefined,
) {
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
  return postgresAccess
}
