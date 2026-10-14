import { describe, expect, test } from 'bun:test'
import { engineProblemRanges } from './engine-check'

const SQL = 'SELECT 1;\nSELEC * FROM users;\nINSERT INTO t VALUES (1);'

describe('engineProblemRanges (the engine compile verdict as underlines)', () => {
  test('a reported position marks the word there', () => {
    const ranges = engineProblemRanges(SQL, {
      supported: true,
      results: [
        { statementStart: 0, ok: true },
        { statementStart: 10, ok: false, message: 'near "SELEC": syntax error', offset: 10 },
      ],
    })
    expect(ranges).toEqual([{ start: 10, end: 15, message: 'near "SELEC": syntax error' }])
    expect(SQL.slice(ranges[0]!.start, ranges[0]!.end)).toBe('SELEC')
  })

  test('without a position, the statement first line is marked, not the whole script', () => {
    const [range] = engineProblemRanges(SQL, {
      supported: true,
      results: [{ statementStart: 10, ok: false, message: 'bad' }],
    })
    expect(SQL.slice(range!.start, range!.end)).toBe('SELEC * FROM users;')
  })

  test('skipped and unsupported verdicts mark nothing', () => {
    expect(
      engineProblemRanges(SQL, {
        supported: true,
        results: [{ statementStart: 30, ok: true, skipped: 'depends-on-earlier' }],
      }),
    ).toEqual([])
    expect(
      engineProblemRanges(SQL, {
        supported: false,
        results: [{ statementStart: 0, ok: false, message: 'x' }],
      }),
    ).toEqual([])
  })

  test('a position on punctuation marks the next visible character', () => {
    const sql = 'SELECT (1'
    const [range] = engineProblemRanges(sql, {
      supported: true,
      results: [{ statementStart: 0, ok: false, message: 'unbalanced', offset: 7 }],
    })
    expect(sql.slice(range!.start, range!.end)).toBe('(')
  })
})
