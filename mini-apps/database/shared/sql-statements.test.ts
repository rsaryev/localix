import { describe, expect, it } from 'bun:test'
import {
  executableStatements,
  splitStatements,
  statementAt,
  statementToRun,
} from './sql-statements'

/** The trimmed text of the statement at `offset`, or null when the caret is not on one. */
const at = (text: string, offset: number) => statementAt(text, offset)?.text.trim() ?? null

describe('statementAt', () => {
  it('returns the whole document when there are no semicolons', () => {
    expect(at('SELECT * FROM users', 5)).toBe('SELECT * FROM users')
  })

  it('picks the statement the cursor sits in, and its terminating semicolon', () => {
    const text = 'SELECT 1;\nSELECT 2;\nSELECT 3;'
    expect(at(text, text.indexOf('SELECT 2') + 3)).toBe('SELECT 2')
    expect(at('SELECT 1;SELECT 2;', 8)).toBe('SELECT 1')
  })

  it('keeps a caret right after the ; on that statement and returns null between them', () => {
    expect(at('SELECT 1;\nSELECT 2;', 9)).toBe('SELECT 1')
    expect(at('SELECT 1;\n\nSELECT 2;', 10)).toBeNull()
    expect(at('SELECT 1;\nSELECT 2;\n\n', 21)).toBeNull()
  })

  it('ignores semicolons inside literals and comments', () => {
    expect(at("SELECT ';' AS a, 2 AS b", 3)).toBe("SELECT ';' AS a, 2 AS b")
    const text = 'SELECT 1 -- a; b\nFROM t;\nSELECT 2'
    expect(at(text, text.indexOf('FROM'))).toBe('SELECT 1 -- a; b\nFROM t')
    expect(at("SELECT 'a''; b' FROM t; SELECT 2", 2)).toBe("SELECT 'a''; b' FROM t")
  })
})

describe('statementToRun', () => {
  it('prefers a selection, else the caret statement, else a lone statement', () => {
    expect(statementToRun('SELECT 1;\nSELECT 2;', '  SELECT 99  ', 0)).toBe('SELECT 99')
    expect(statementToRun('SELECT 1;\nSELECT 2;', '', 12)).toBe('SELECT 2')
    expect(statementToRun('SELECT 1\n\n', '', 9)).toBe('SELECT 1')
    expect(statementToRun('SELECT 1;\n\nSELECT 2;\n\n', '', 10)).toBe('')
    expect(statementToRun('   ', '', 0)).toBe('')
  })
})

describe('splitStatements', () => {
  it('splits top-level statements, trimming and dropping terminators/empties', () => {
    expect(splitStatements('SELECT 1;\nSELECT 2;\n')).toEqual(['SELECT 1', 'SELECT 2'])
    expect(splitStatements(';;')).toEqual([])
  })

  it('uses dialect-specific literal and comment boundaries', () => {
    expect(splitStatements(String.raw`SELECT E'one\'; two'; SELECT 2`, 'postgres')).toEqual([
      String.raw`SELECT E'one\'; two'`,
      'SELECT 2',
    ])
    expect(splitStatements('SELECT [semi;colon] FROM t; SELECT 2', 'mssql')).toHaveLength(2)
    expect(splitStatements('SELECT 1 # ; hidden\n; SELECT 2', 'mysql')).toHaveLength(2)
    expect(splitStatements('SELECT 1--2; SELECT 2', 'mysql')).toEqual(['SELECT 1--2', 'SELECT 2'])
    expect(splitStatements('SELECT 1--2; SELECT 2')).toEqual(['SELECT 1--2; SELECT 2'])
  })

  it('keeps a dollar-quoted PostgreSQL body whole', () => {
    expect(splitStatements('DO $b$ BEGIN x; y; END $b$; SELECT 2', 'postgres')).toEqual([
      'DO $b$ BEGIN x; y; END $b$',
      'SELECT 2',
    ])
  })

  // The defect the block walk exists for: each body below used to be torn at its inner `;`.
  it('keeps a SQLite trigger body whole', () => {
    const trigger =
      'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = 1; DELETE FROM c; END'
    expect(splitStatements(`${trigger}; SELECT 1`, 'sqlite')).toEqual([trigger, 'SELECT 1'])
  })

  it('keeps a MySQL routine with nested IF/CASE/labels whole', () => {
    const proc = [
      'CREATE PROCEDURE p() lbl: BEGIN',
      '  IF x THEN SELECT 1; END IF;',
      '  CASE y WHEN 1 THEN SELECT 2; END CASE;',
      '  SELECT CASE WHEN z THEN 1 END;',
      'END lbl',
    ].join('\n')
    expect(splitStatements(`${proc};\nSELECT 3`, 'mysql')).toEqual([proc, 'SELECT 3'])
  })

  it('keeps a PostgreSQL BEGIN ATOMIC body and a parenthesized rule action whole', () => {
    const fn = 'CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END'
    expect(splitStatements(`${fn}; SELECT 3`, 'postgres')).toEqual([fn, 'SELECT 3'])
    const rule = 'CREATE RULE r AS ON INSERT TO t DO ALSO (INSERT INTO a VALUES (1); NOTIFY t)'
    expect(splitStatements(`${rule}; SELECT 3`, 'postgres')).toEqual([rule, 'SELECT 3'])
  })

  it('treats a leading BEGIN as transaction control and splits after it', () => {
    expect(splitStatements('BEGIN; INSERT INTO t VALUES (1); COMMIT;', 'sqlite')).toEqual([
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
    ])
    expect(splitStatements('BEGIN TRANSACTION; SELECT 1; END;', 'sqlite')).toHaveLength(3)
  })

  it('keeps a T-SQL IF … BEGIN TRAN … END block whole', () => {
    const block = 'IF 1 = 1 BEGIN BEGIN TRAN; UPDATE t SET a = 1; COMMIT; END'
    expect(splitStatements(`${block}; SELECT 1`, 'mssql')).toEqual([block, 'SELECT 1'])
  })

  it('does not open a body for a column that happens to be named begin', () => {
    expect(splitStatements('SELECT begin FROM t; SELECT 2', 'mysql')).toHaveLength(2)
  })
})

describe('executableStatements', () => {
  it('reports each statement with its trimmed text and absolute start', () => {
    const text = '  CREATE TABLE u(id int);\n  INSERT INTO u VALUES (1);  '
    expect(executableStatements(text, 'sqlite')).toEqual([
      { text: 'CREATE TABLE u(id int)', start: 2 },
      { text: 'INSERT INTO u VALUES (1)', start: text.indexOf('INSERT') },
    ])
  })

  it('drops comment-only segments so a trailing note is not a second statement', () => {
    expect(executableStatements('SELECT 1; -- done\n', 'postgres')).toEqual([
      { text: 'SELECT 1', start: 0 },
    ])
    expect(executableStatements('/* a */ ; ;', 'sqlite')).toEqual([])
  })

  it('keeps a comment that leads a statement as part of it', () => {
    const text = 'SELECT 1;\n-- next\nSELECT 2'
    expect(executableStatements(text, 'sqlite')[1]).toEqual({
      text: '-- next\nSELECT 2',
      start: text.indexOf('--'),
    })
  })
})
