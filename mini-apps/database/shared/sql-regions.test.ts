import { describe, expect, test } from 'bun:test'

import {
  CLICKHOUSE_SQL_GRAMMAR,
  findQuestionPlaceholders,
  maskSqlNonCode,
  MSSQL_SQL_GRAMMAR,
  MYSQL_SQL_GRAMMAR,
  POSTGRES_SQL_GRAMMAR,
  type SqlLiteralGrammar,
} from './sql-regions'

const PLAIN: SqlLiteralGrammar = {
  backslashEscapes: false,
  bracketIdentifiers: false,
  backtickIdentifiers: false,
  dollarQuotes: false,
  executableComments: false,
  lineCommentRequiresSpace: false,
  hashLineComments: false,
  nestedBlockComments: false,
  prefixedBackslashStrings: false,
}

describe('maskSqlNonCode', () => {
  test('preserves length and newlines so offsets stay usable', () => {
    const sql = "SELECT 'abc' -- note\n, /* c */ x"
    const masked = maskSqlNonCode(sql, PLAIN)
    expect(masked.length).toBe(sql.length)
    expect(masked).toBe('SELECT       ' + ' '.repeat(7) + '\n,         x')
  })

  test('stays index-aligned across astral characters', () => {
    // Built with `split('')` (code UNITS). Spreading iterates code POINTS and collapses a
    // surrogate pair into one slot, which shifts every later offset left.
    const sql = "SELECT '🙂🙂🙂🙂🙂🙂🙂🙂', ?"
    const masked = maskSqlNonCode(sql, PLAIN)
    expect(masked.length).toBe(sql.length)
    expect(masked.indexOf('?')).toBe(sql.indexOf('?'))
    expect(masked).not.toContain('🙂')
  })

  test('doubled quotes keep a literal open', () => {
    expect(maskSqlNonCode(`SELECT 'it''s x' , y`, PLAIN)).toBe(`SELECT           , y`)
  })

  test('an unterminated literal or comment consumes the rest without looping', () => {
    expect(maskSqlNonCode(`SELECT 'abc`, PLAIN)).toBe('SELECT     ')
    expect(maskSqlNonCode(`SELECT /* abc`, PLAIN)).toBe('SELECT       ')
    expect(maskSqlNonCode(`SELECT 'a\\`, CLICKHOUSE_SQL_GRAMMAR)).toBe('SELECT    ')
  })
})

describe('grammar flags each fix a specific engine', () => {
  test('backslashEscapes: on, an escaped quote keeps the literal open; off, it closes it', () => {
    //          0123456789...
    const sql = `SELECT 'it\\'s ?' , ?`
    expect(sql).toBe("SELECT 'it\\'s ?' , ?")
    // MySQL/ClickHouse: `\'` is an escaped quote, so indices 7–15 are ONE literal and the
    // only placeholder is the trailing `?` at 19.
    expect(findQuestionPlaceholders(sql, CLICKHOUSE_SQL_GRAMMAR)).toEqual([19])
    // T-SQL/standard Postgres: the backslash is a literal character and the quote at 11
    // CLOSES the string. That flips the quote parity for the rest of the line — the `?` at
    // 14 becomes code, and the `?` at 19 falls inside the literal opened at 15.
    //
    // Both readings find exactly one placeholder, in DIFFERENT places, from the same bytes.
    // That is why a single hard-coded grammar cannot serve every engine, and why the
    // dialect-agnostic read-only guard has to intersect readings instead of picking one.
    expect(findQuestionPlaceholders(sql, MSSQL_SQL_GRAMMAR)).toEqual([14])
  })

  test('bracketIdentifiers: T-SQL `[a?b]` is an identifier; ClickHouse `[?]` is an array', () => {
    expect(findQuestionPlaceholders('SELECT [a?b] , ?', MSSQL_SQL_GRAMMAR)).toEqual([15])
    expect(findQuestionPlaceholders('SELECT [?, ?]', CLICKHOUSE_SQL_GRAMMAR)).toEqual([8, 11])
    // `]]` doubling keeps the identifier open.
    expect(findQuestionPlaceholders('SELECT [we]]ird ?] , ?', MSSQL_SQL_GRAMMAR)).toEqual([21])
  })

  test('backtickIdentifiers: quoted in ClickHouse, not a quote character in T-SQL', () => {
    expect(findQuestionPlaceholders('SELECT `a?b` , ?', CLICKHOUSE_SQL_GRAMMAR)).toEqual([15])
    expect(findQuestionPlaceholders('SELECT `a?b` , ?', MSSQL_SQL_GRAMMAR)).toEqual([9, 15])
  })

  test('executableComments: MySQL version comments remain code', () => {
    const mysql = { ...CLICKHOUSE_SQL_GRAMMAR, executableComments: true }
    const sql = 'SELECT /*!40000 ? + */ ?'
    expect(findQuestionPlaceholders(sql, mysql)).toEqual([16, 23])
    expect(findQuestionPlaceholders(sql, CLICKHOUSE_SQL_GRAMMAR)).toEqual([23])
  })

  test('lineCommentRequiresSpace: MySQL does not treat --2 as a comment', () => {
    const mysql = { ...CLICKHOUSE_SQL_GRAMMAR, lineCommentRequiresSpace: true }
    expect(findQuestionPlaceholders('SELECT 1--2, ?', mysql)).toEqual([13])
    expect(findQuestionPlaceholders('SELECT 1-- 2, ?', mysql)).toEqual([])
    expect(findQuestionPlaceholders('SELECT 1--2, ?', CLICKHOUSE_SQL_GRAMMAR)).toEqual([])
  })

  test('hashLineComments: MySQL and ClickHouse ignore placeholders after #', () => {
    expect(findQuestionPlaceholders('SELECT 1 # ?\n, ?', MYSQL_SQL_GRAMMAR)).toEqual([15])
    expect(findQuestionPlaceholders('SELECT 1 # ?\n, ?', PLAIN)).toEqual([11, 15])
  })

  test('nestedBlockComments: PostgreSQL keeps the outer comment open', () => {
    const sql = 'SELECT /* outer /* inner */ ? */ ?'
    expect(findQuestionPlaceholders(sql, POSTGRES_SQL_GRAMMAR)).toEqual([33])
    expect(findQuestionPlaceholders(sql, MYSQL_SQL_GRAMMAR)).toEqual([28, 33])
  })

  test("prefixedBackslashStrings: only E'…' enables escapes in PostgreSQL", () => {
    expect(
      findQuestionPlaceholders(String.raw`SELECT E'it\'s ?' , ?`, POSTGRES_SQL_GRAMMAR),
    ).toEqual([20])
    expect(
      findQuestionPlaceholders(String.raw`SELECT 'it\'s ?' , ?`, POSTGRES_SQL_GRAMMAR),
    ).toEqual([14])
  })
})

describe('findQuestionPlaceholders', () => {
  test('ignores question marks in literals, identifiers and both comment kinds', () => {
    const sql = `SELECT '?' AS a, "?" AS b -- ?\nWHERE id = ? /* ? */`
    expect(findQuestionPlaceholders(sql, CLICKHOUSE_SQL_GRAMMAR)).toEqual([
      sql.indexOf('WHERE id = ?') + 'WHERE id = '.length,
    ])
  })

  test('returns an empty list when there is nothing to bind', () => {
    expect(findQuestionPlaceholders(`SELECT 'why?' FROM t`, PLAIN)).toEqual([])
    expect(findQuestionPlaceholders('', PLAIN)).toEqual([])
  })
})
