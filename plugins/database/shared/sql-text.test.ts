import { describe, expect, test } from 'bun:test'
import { sqlStringLiteral, stripStatementTerminator } from './sql-text'

describe('sql text helpers', () => {
  test('strips every trailing terminator and surrounding space, keeping inner ones', () => {
    expect(stripStatementTerminator('  CREATE INDEX i ON t (a);; \n')).toBe(
      'CREATE INDEX i ON t (a)',
    )
    expect(stripStatementTerminator("SELECT ';'")).toBe("SELECT ';'")
  })

  test('doubles quotes inside a literal', () => {
    expect(sqlStringLiteral("o'brien")).toBe("'o''brien'")
  })
})
