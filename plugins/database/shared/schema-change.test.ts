import { describe, expect, it } from 'bun:test'
import { isSchemaChangingStatement } from './schema-change'

describe('isSchemaChangingStatement', () => {
  it('flags DDL (CREATE / DROP / ALTER / RENAME)', () => {
    expect(isSchemaChangingStatement('CREATE TABLE t (id int)')).toBe(true)
    expect(isSchemaChangingStatement('drop table t')).toBe(true)
    expect(isSchemaChangingStatement('ALTER TABLE t ADD COLUMN x int')).toBe(true)
    expect(isSchemaChangingStatement('RENAME TABLE a TO b')).toBe(true)
    expect(isSchemaChangingStatement('CREATE INDEX i ON t (x)')).toBe(true)
  })

  it('ignores reads and data-only DML', () => {
    expect(isSchemaChangingStatement('SELECT * FROM t')).toBe(false)
    expect(isSchemaChangingStatement('INSERT INTO t VALUES (1)')).toBe(false)
    expect(isSchemaChangingStatement('UPDATE t SET x = 1')).toBe(false)
    expect(isSchemaChangingStatement('DELETE FROM t')).toBe(false)
    expect(isSchemaChangingStatement('TRUNCATE t')).toBe(false) // data-only, not schema shape
  })

  it('sees through leading comments', () => {
    expect(isSchemaChangingStatement('-- make it\nCREATE TABLE t (id int)')).toBe(true)
    expect(isSchemaChangingStatement('/* c */ SELECT 1')).toBe(false)
  })

  it('flags a batch where any statement is DDL', () => {
    expect(isSchemaChangingStatement('SELECT 1; CREATE TABLE t (id int)')).toBe(true)
    expect(isSchemaChangingStatement('INSERT INTO t VALUES (1); SELECT 1')).toBe(false)
  })
})
