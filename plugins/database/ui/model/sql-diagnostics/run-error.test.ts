import { describe, expect, test } from 'bun:test'
import { engineErrorName } from './engine-error'
import { locateRunError } from './run-error'

describe('engineErrorName reads the offender out of each engine’s own sentence', () => {
  test.each([
    ['relation "usres" does not exist', 'table', 'usres'],
    ['column "nme" does not exist', 'column', 'nme'],
    ['column u.nmae does not exist', 'column', 'nmae'],
    ['missing FROM-clause entry for table "x"', 'alias', 'x'],
    ['syntax error at or near "FORM"', 'syntax', 'FORM'],
    ['Catalog Error: Table with name usres does not exist!', 'table', 'usres'],
    ['Binder Error: Referenced column "nme" not found in FROM clause!', 'column', 'nme'],
    ["Table 'shop.usres' doesn't exist", 'table', 'usres'],
    ["Unknown column 'nme' in 'field list'", 'column', 'nme'],
    [
      "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'FORM users' at line 1",
      'syntax',
      'FORM',
    ],
    ['no such table: usres', 'table', 'usres'],
    ['no such column: nme', 'column', 'nme'],
    ['near "FORM": syntax error', 'syntax', 'FORM'],
    ["Invalid object name 'usres'.", 'table', 'usres'],
    ["Invalid column name 'nme'.", 'column', 'nme'],
    ['The multi-part identifier "x.id" could not be bound.', 'alias', 'x'],
    ["Incorrect syntax near 'FORM'.", 'syntax', 'FORM'],
    ["Code: 60. DB::Exception: Unknown table expression identifier 'usres'", 'table', 'usres'],
    ['Code: 47. DB::Exception: Unknown expression identifier `nme` in scope', 'column', 'nme'],
  ])('%s', (message, kind, name) => {
    expect(engineErrorName(message)).toMatchObject({ kind, name })
  })

  test('a message that names nothing is null', () => {
    expect(engineErrorName('permission denied for table users')).toBeNull()
    expect(engineErrorName('deadlock detected')).toBeNull()
  })
})

describe('locateRunError', () => {
  const buffer = 'SELECT 1;\nSELECT u.nmae FROM users u;\n'
  const failure = { sql: 'SELECT u.nmae FROM users u', message: 'column u.nmae does not exist' }

  test('underlines the blamed name inside the statement, at its buffer offset', () => {
    const range = locateRunError(buffer, failure, 'postgres')!
    expect(buffer.slice(range.start, range.end)).toBe('nmae')
    expect(range.message).toBe('column u.nmae does not exist')
  })

  test('the occurrence nearest the cursor wins when a script repeats the statement', () => {
    const twice = `${failure.sql};\n${failure.sql};`
    const second = twice.lastIndexOf(failure.sql)
    expect(locateRunError(twice, failure, 'postgres', second + 3)!.start).toBeGreaterThan(second)
    expect(locateRunError(twice, failure, 'postgres', 0)!.start).toBeLessThan(second)
  })

  test('an edited statement has no range: the marker must not outlive its text', () => {
    expect(locateRunError('SELECT u.name FROM users u', failure, 'postgres')).toBeNull()
  })

  test('a name inside a string is not the offender; an unrecognised error marks the first token', () => {
    const sql = "SELECT 'usres' FROM usres"
    const range = locateRunError(
      sql,
      { sql, message: 'relation "usres" does not exist' },
      'postgres',
    )!
    expect(range.start).toBe(sql.lastIndexOf('usres'))
    const other = locateRunError(sql, { sql, message: 'deadlock detected' }, 'postgres')!
    expect(sql.slice(other.start, other.end)).toBe('SELECT')
  })
})
