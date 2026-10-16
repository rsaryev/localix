import { describe, expect, test } from 'bun:test'
import { createSqliteDriver } from '../../backend/drivers/sqlite'
import { explainQuery } from './sqlExplain'

describe('EXPLAIN against bundled local drivers', () => {
  test('SQLite returns its structured query-plan columns without executing the query', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    try {
      await driver.query('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)')
      await driver.query('CREATE INDEX users_email_idx ON users(email)')
      const sql = explainQuery(`SELECT * FROM users WHERE email = 'a@example.com'`, 'sqlite')
      expect(sql).not.toBeNull()
      const result = await driver.query(sql!)
      expect(result.columns.map((column) => column.name)).toEqual([
        'id',
        'parent',
        'notused',
        'detail',
      ])
      expect(String(result.rows[0]?.[3])).toContain('users_email_idx')
    } finally {
      await driver.close()
    }
  })
})
