import { expect, test } from 'bun:test'
import { pgTableSchema } from './postgres-introspect'
import type { PgPolicyRow } from './postgres-catalog-rows'
import type { RowsExecutor } from './fk-rows'

function catalogWithPolicies(policies: PgPolicyRow[]): RowsExecutor {
  return async <T>(sql: string) =>
    (sql.includes('FROM pg_catalog.pg_policy policy') ? policies : []) as T[]
}

const policy: PgPolicyRow = {
  policy_name: 'restricted',
  command_kind: 'SELECT',
  permissive: false,
  roles: [],
  using_expression: '  ',
  check_expression: '\n',
}

test('policy metadata remains present with no relation flags and retains restrictive semantics', async () => {
  const schema = await pgTableSchema(catalogWithPolicies([policy]), 'public', 'items')
  expect(schema.postgresRowSecurity).toEqual({
    enabled: false,
    forced: false,
    policies: [{ name: 'restricted', command: 'SELECT', permissive: false, roles: ['PUBLIC'] }],
  })
})

test('unsupported policy commands do not synthesize row-security state', async () => {
  const schema = await pgTableSchema(
    catalogWithPolicies([{ ...policy, command_kind: 'UNKNOWN' }]),
    'public',
    'items',
  )
  expect(schema).not.toHaveProperty('postgresRowSecurity')
})
