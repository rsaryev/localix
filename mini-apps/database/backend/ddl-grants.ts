import type { DbDialect, DbPostgresPrivilegeGrant, DbTableSchema } from './drivers/port'
import { quoteIdent } from './sql-ident'
import { postgresRelationKind } from './ddl-create-parts'

/**
 * GRANT / REVOKE, and the ordering that makes a replayed grant set land the same way twice.
 *
 * Order is not cosmetic here: privileges are emitted in a fixed sequence so a re-generated script
 * diffs cleanly against the previous one, which is the only way a person can tell an ACL change
 * from a reshuffle.
 */

function orderPostgresGrants<TPrivilege extends string>(
  grants: DbPostgresPrivilegeGrant<TPrivilege>[],
  owner: string,
  inheritedGrantOptions: DbPostgresPrivilegeGrant<TPrivilege>[] = [],
): DbPostgresPrivilegeGrant<TPrivilege>[] {
  const grantOptions = new Map<string, Set<string>>()
  const holderSet = (privilege: string) => {
    const holders = grantOptions.get(privilege) ?? new Set<string>()
    holders.add(owner)
    grantOptions.set(privilege, holders)
    return holders
  }
  for (const grant of inheritedGrantOptions) {
    if (grant.grantable && grant.grantee) holderSet(grant.privilege).add(grant.grantee)
  }
  const remaining = grants.map((grant, index) => ({ grant, index }))
  const ordered: Array<DbPostgresPrivilegeGrant<TPrivilege>> = []
  const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
  const compare = (
    left: { grant: DbPostgresPrivilegeGrant<TPrivilege>; index: number },
    right: { grant: DbPostgresPrivilegeGrant<TPrivilege>; index: number },
  ) =>
    Number(right.grant.grantable) - Number(left.grant.grantable) ||
    compareText(left.grant.grantor, right.grant.grantor) ||
    compareText(left.grant.grantee ?? '', right.grant.grantee ?? '') ||
    compareText(left.grant.privilege, right.grant.privilege) ||
    left.index - right.index
  while (remaining.length) {
    const executable = remaining
      .filter(({ grant }) => holderSet(grant.privilege).has(grant.grantor))
      .sort(compare)[0]
    const selected = executable ?? remaining.sort(compare)[0]!
    remaining.splice(remaining.indexOf(selected), 1)
    ordered.push(selected.grant)
    if (selected.grant.grantable && selected.grant.grantee)
      holderSet(selected.grant.privilege).add(selected.grant.grantee)
  }
  return ordered
}

export function renderPostgresGrants<TPrivilege extends string>(
  grants: DbPostgresPrivilegeGrant<TPrivilege>[],
  owner: string,
  target: string,
  q: (name: string) => string,
  objectKind: 'TABLE' | 'SEQUENCE',
  column?: string,
  inheritedGrantOptions: DbPostgresPrivilegeGrant<TPrivilege>[] = [],
): string[] {
  const ordered = orderPostgresGrants(grants, owner, inheritedGrantOptions)
  const groups: Array<{
    grantor: string
    grantee?: string
    grantable: boolean
    privileges: string[]
  }> = []
  for (const grant of ordered) {
    const previous = groups.at(-1)
    if (
      previous?.grantor === grant.grantor &&
      previous.grantee === grant.grantee &&
      previous.grantable === grant.grantable
    ) {
      previous.privileges.push(grant.privilege)
    } else {
      groups.push({
        grantor: grant.grantor,
        ...(grant.grantee ? { grantee: grant.grantee } : {}),
        grantable: grant.grantable,
        privileges: [grant.privilege],
      })
    }
  }
  return groups.flatMap((group) => {
    const privileges = group.privileges
      .map((privilege) => `${privilege}${column ? ` (${q(column)})` : ''}`)
      .join(', ')
    const statement = `GRANT ${privileges} ON ${objectKind} ${target} TO ${
      group.grantee ? q(group.grantee) : 'PUBLIC'
    }${group.grantable ? ' WITH GRANT OPTION' : ''};`
    return group.grantor === owner
      ? [statement]
      : [
          `SET SESSION AUTHORIZATION ${q(group.grantor)};`,
          statement,
          'RESET SESSION AUTHORIZATION;',
        ]
  })
}

/** PostgreSQL owner and explicit table/column ACL restoration, deliberately emitted last. */
export function buildPostgresAccessStatements(table: DbTableSchema, dialect: DbDialect): string[] {
  const access = table.postgresAccess
  if (dialect !== 'postgres' || !access || (table.type === 'view' && !table.createScript?.trim()))
    return []
  const q = (name: string) => quoteIdent(name, 'postgres')
  const target =
    table.postgresRelation?.persistence === 'TEMPORARY'
      ? q(table.name)
      : table.schema
        ? `${q(table.schema)}.${q(table.name)}`
        : q(table.name)
  const statements = [`ALTER ${postgresRelationKind(table)} ${target} OWNER TO ${q(access.owner)};`]
  if (access.tableGrants !== undefined) {
    statements.push(`REVOKE ALL PRIVILEGES ON TABLE ${target} FROM ${q(access.owner)};`)
    statements.push(...renderPostgresGrants(access.tableGrants, access.owner, target, q, 'TABLE'))
  }
  for (const column of access.columnGrants ?? []) {
    statements.push(
      ...renderPostgresGrants(
        column.grants,
        access.owner,
        target,
        q,
        'TABLE',
        column.column,
        access.tableGrants ?? [],
      ),
    )
  }
  return statements
}
