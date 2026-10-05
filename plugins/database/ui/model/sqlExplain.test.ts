import { describe, expect, it } from 'bun:test'
import { DATABASE_DIALECTS } from '../../shared/driver-catalog'
import { explainQuery, supportsExplain } from './sqlExplain'

describe('explainQuery', () => {
  it('uses EXPLAIN QUERY PLAN for sqlite', () => {
    expect(explainQuery('SELECT * FROM users;', 'sqlite')).toBe(
      'EXPLAIN QUERY PLAN SELECT * FROM users;',
    )
  })

  it('uses plain EXPLAIN (no ANALYZE) for postgres/mysql, stripping a trailing ;', () => {
    expect(explainQuery('SELECT 1 ;', 'postgres')).toBe('EXPLAIN SELECT 1;')
    expect(explainQuery('SELECT 1', 'mysql')).toBe('EXPLAIN SELECT 1;')
    expect(explainQuery('SELECT 1', 'clickhouse')).toBe('EXPLAIN SELECT 1;')
  })

  it('returns null for mssql and blank input', () => {
    expect(explainQuery('SELECT 1', 'mssql')).toBeNull()
    expect(explainQuery('   ', 'postgres')).toBeNull()
  })

  it('supportsExplain gates by dialect', () => {
    expect(supportsExplain('sqlite')).toBe(true)
    expect(supportsExplain('mssql')).toBe(false)
  })

  it('keeps the manifest capability and query builder in sync for every driver', () => {
    for (const dialect of DATABASE_DIALECTS) {
      expect(explainQuery('SELECT 1', dialect) !== null).toBe(supportsExplain(dialect))
    }
  })
})
