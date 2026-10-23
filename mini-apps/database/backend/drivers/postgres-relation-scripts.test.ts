import { expect, test } from 'bun:test'
import { pgTableSchema } from './postgres-introspect'
import type { RowsExecutor } from './fk-rows'

test('introspection skips blank executable objects and trims view terminators', async () => {
  const rows: RowsExecutor = async <T>(sql: string) => {
    if (sql.includes('pg_get_viewdef')) {
      return [{ definition: ' SELECT 1;;;  ', relkind: 'v' }] as T[]
    }
    if (sql.includes('pg_get_triggerdef')) {
      return [
        { trigger_name: 'blank', create_script: ' \n ', enabled_state: 'D' },
        { trigger_name: 'active', create_script: ' CREATE TRIGGER active ', enabled_state: 'O' },
      ] as T[]
    }
    if (sql.includes('pg_get_ruledef')) {
      return [
        { rule_name: 'blank', create_script: '\t', enabled_state: 'A' },
        { rule_name: 'active', create_script: ' CREATE RULE active ', enabled_state: 'O' },
      ] as T[]
    }
    return [] as T[]
  }
  const schema = await pgTableSchema(rows, 'odd"schema', 'view name')
  expect(schema.createScript).toBe('CREATE VIEW "odd""schema"."view name" AS\nSELECT 1;')
  expect(schema.triggers).toEqual([{ name: 'active', createScript: 'CREATE TRIGGER active' }])
  expect(schema.rules).toEqual([{ name: 'active', createScript: 'CREATE RULE active' }])
})
