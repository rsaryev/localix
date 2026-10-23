import { describe, expect, test } from 'bun:test'
import {
  defaultSqlCompletions,
  defaultSqlPresets,
  validateDefaultSqlExpression,
} from './defaultSql'

describe('DEFAULT SQL expression model', () => {
  test('offers data-type-aware, dialect-specific presets', () => {
    const postgresUuid = defaultSqlPresets('postgres', 'uuid')
    expect(postgresUuid[0]?.value).toBe('gen_random_uuid()')
    expect(postgresUuid.map((item) => item.value)).toContain('CURRENT_TIMESTAMP')

    const sqliteDate = defaultSqlPresets('sqlite', 'timestamp')
    expect(sqliteDate[0]?.value).toBe('CURRENT_TIMESTAMP')
    expect(sqliteDate.map((item) => item.value)).toContain("(datetime('now'))")
  })

  test('completion vocabulary contains expressions, not schema/statement noise', () => {
    const completions = defaultSqlCompletions('mssql', 'UNIQUEIDENTIFIER')
    expect(completions.map((item) => item.label)).toContain('NEWID()')
    expect(completions.map((item) => item.label)).toContain("''")
    expect(completions.map((item) => item.label)).not.toContain('SELECT')
    expect(completions.map((item) => item.label)).not.toContain('FROM')
  })

  test('accepts one balanced SQL expression', () => {
    expect(validateDefaultSqlExpression("('draft')")).toBeNull()
    expect(validateDefaultSqlExpression("(datetime('now'))")).toBeNull()
    expect(validateDefaultSqlExpression("'semi;colon'")).toBeNull()
  })

  test('rejects duplicated DEFAULT, statements and unbalanced parentheses', () => {
    expect(validateDefaultSqlExpression('DEFAULT 1')).toContain('added automatically')
    expect(validateDefaultSqlExpression('1; DROP TABLE users')).toContain('one expression')
    expect(validateDefaultSqlExpression('(now()')).toContain('not closed')
    expect(validateDefaultSqlExpression('now())')).toContain('no matching')
    expect(validateDefaultSqlExpression("'draft")).toContain('quoted value is not closed')
  })
})
