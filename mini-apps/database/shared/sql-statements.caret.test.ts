import { describe, expect, it } from 'bun:test'
// Caret and selection behaviour of the one statement splitter the console, the `.sql` runner and
// the backend's script runner all use (it was a UI-only copy until the backend needed it too).
import { splitStatements, statementAt, statementToRun } from './sql-statements'

/** The trimmed text of the statement at `offset`, or null when the caret is not on one. */
const at = (text: string, offset: number) => statementAt(text, offset)?.text.trim() ?? null

describe('statementAt', () => {
  it('returns the whole document when there are no semicolons', () => {
    expect(at('SELECT * FROM users', 5)).toBe('SELECT * FROM users')
  })

  it('picks the statement the cursor sits in', () => {
    const text = 'SELECT 1;\nSELECT 2;\nSELECT 3;'
    expect(at(text, text.indexOf('SELECT 2') + 3)).toBe('SELECT 2')
  })

  it('picks the first statement when the caret is on its terminating semicolon', () => {
    const text = 'SELECT 1;SELECT 2;'
    expect(at(text, text.indexOf(';'))).toBe('SELECT 1')
  })

  it('runs the last (unterminated) statement when the caret is at its end', () => {
    const text = 'SELECT 1;\nSELECT 2'
    expect(at(text, text.length)).toBe('SELECT 2')
  })

  // --- "not on a statement" → null (the caret must be on a query to run it) ---

  it('keeps a caret right after the ; (same line) on THAT statement, never the next', () => {
    const text = 'SELECT 1;\nSELECT 2;'
    // offset at the '\n' right after stmt1's ';' → still stmt1 (not stmt2).
    expect(at(text, text.indexOf(';') + 1)).toBe('SELECT 1')
  })

  it('returns null on a blank line between statements', () => {
    const text = 'SELECT 1;\n\nSELECT 2;'
    // the blank line (second '\n') is not on any statement.
    expect(at(text, text.indexOf(';') + 2)).toBeNull()
  })

  it('returns null in trailing whitespace after the last terminated statement', () => {
    const text = 'SELECT 1;\nSELECT 2;\n\n'
    expect(at(text, text.length)).toBeNull()
  })

  it('ignores semicolons inside single-quoted strings', () => {
    expect(at("SELECT ';' AS a, 2 AS b", 3)).toBe("SELECT ';' AS a, 2 AS b")
  })

  it('ignores semicolons inside line comments', () => {
    const text = 'SELECT 1 -- a; b\nFROM t;\nSELECT 2'
    expect(at(text, text.indexOf('FROM'))).toBe('SELECT 1 -- a; b\nFROM t')
  })

  it('ignores semicolons inside block comments', () => {
    expect(at('SELECT /* ; ; */ 1 FROM t; SELECT 2', 2)).toBe('SELECT /* ; ; */ 1 FROM t')
  })

  it('handles doubled-quote escapes', () => {
    expect(at("SELECT 'a''; b' FROM t; SELECT 2", 2)).toBe("SELECT 'a''; b' FROM t")
  })
})

describe('statementToRun', () => {
  it('prefers a non-empty selection over the cursor statement', () => {
    expect(statementToRun('SELECT 1;\nSELECT 2;', '  SELECT 99  ', 0)).toBe('SELECT 99')
  })

  it('runs the statement the cursor is on when nothing is selected', () => {
    const text = 'SELECT 1;\nSELECT 2;'
    expect(statementToRun(text, '', text.indexOf('SELECT 2') + 2)).toBe('SELECT 2')
  })

  it('runs a single-statement buffer regardless of caret position', () => {
    // caret in trailing whitespace, but there is only one statement → still runs it.
    expect(statementToRun('SELECT 1\n\n', '', 9)).toBe('SELECT 1')
  })

  it('returns "" for a multi-statement buffer when the caret is on a blank gap, not any statement', () => {
    const text = 'SELECT 1;\n\nSELECT 2;\n\n'
    expect(statementToRun(text, '', text.indexOf(';') + 2)).toBe('') // blank line between
    expect(statementToRun(text, '', text.length)).toBe('') // trailing blank lines
  })

  it('returns "" when there is nothing to run', () => {
    expect(statementToRun('   ', '', 0)).toBe('')
  })
})

describe('splitStatements', () => {
  it('splits top-level statements, trimming and dropping terminators/empties', () => {
    expect(splitStatements('SELECT 1;\nSELECT 2;\n')).toEqual(['SELECT 1', 'SELECT 2'])
    expect(splitStatements('  UPDATE t SET a=1 ')).toEqual(['UPDATE t SET a=1'])
    expect(splitStatements(';;')).toEqual([])
  })

  it('ignores semicolons inside strings and comments', () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
      'SELECT 1',
    ])
    expect(splitStatements('SELECT 1 -- x; y\n; SELECT 2')).toEqual([
      'SELECT 1 -- x; y',
      'SELECT 2',
    ])
  })

  it('ignores semicolons inside dollar-quoted Postgres bodies', () => {
    const fn =
      'CREATE FUNCTION f() RETURNS int AS $$ BEGIN a; b; RETURN 1; END $$ LANGUAGE plpgsql; SELECT 1'
    expect(splitStatements(fn)).toEqual([
      'CREATE FUNCTION f() RETURNS int AS $$ BEGIN a; b; RETURN 1; END $$ LANGUAGE plpgsql',
      'SELECT 1',
    ])
    expect(splitStatements('DO $body$ BEGIN x; y; END $body$; SELECT 2')).toEqual([
      'DO $body$ BEGIN x; y; END $body$',
      'SELECT 2',
    ])
  })

  it('uses dialect-specific literal and comment boundaries', () => {
    expect(splitStatements(String.raw`SELECT E'one\'; two'; SELECT 2`, 'postgres')).toEqual([
      String.raw`SELECT E'one\'; two'`,
      'SELECT 2',
    ])
    expect(splitStatements('SELECT 1 /* outer /* ; */ still */; SELECT 2', 'postgres')).toEqual([
      'SELECT 1 /* outer /* ; */ still */',
      'SELECT 2',
    ])
    expect(splitStatements('SELECT [semi;colon] FROM t; SELECT 2', 'mssql')).toEqual([
      'SELECT [semi;colon] FROM t',
      'SELECT 2',
    ])
    expect(splitStatements('SELECT 1 # ; hidden\n; SELECT 2', 'mysql')).toEqual([
      'SELECT 1 # ; hidden',
      'SELECT 2',
    ])
    expect(splitStatements('SELECT 1--2; SELECT 2', 'mysql')).toEqual(['SELECT 1--2', 'SELECT 2'])
  })

  it('fails conservatively when no dialect is available', () => {
    // `--2` is ambiguous: code in MySQL, a line comment elsewhere. Without a live
    // connection, keep it in one unit instead of risking execution of a false split.
    expect(splitStatements('SELECT 1--2; SELECT 2')).toEqual(['SELECT 1--2; SELECT 2'])
  })
})
