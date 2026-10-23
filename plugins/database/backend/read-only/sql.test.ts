import { describe, expect, it } from 'bun:test'
import { isReadOnlyStatement, isReadOnlyStatementForDialect } from './sql'

describe('isReadOnlyStatement', () => {
  it('allows plain reads', () => {
    expect(isReadOnlyStatement('SELECT * FROM users')).toBe(true)
    expect(isReadOnlyStatement('  select id, name from t where id = 1  ')).toBe(true)
    expect(isReadOnlyStatement('SELECT 1')).toBe(true)
    expect(isReadOnlyStatement('EXPLAIN SELECT * FROM t')).toBe(true)
    expect(isReadOnlyStatement('EXPLAIN ANALYZE SELECT * FROM t')).toBe(true)
    expect(isReadOnlyStatement('SHOW TABLES')).toBe(true)
    expect(isReadOnlyStatement('DESCRIBE users')).toBe(true)
    expect(isReadOnlyStatement('DESC users')).toBe(true)
    expect(isReadOnlyStatement('VALUES (1), (2)')).toBe(true)
    expect(isReadOnlyStatement('TABLE users')).toBe(true)
    expect(isReadOnlyStatement('(SELECT 1) UNION (SELECT 2)')).toBe(true)
  })

  it('allows a WITH-cte that ends in a SELECT', () => {
    expect(
      isReadOnlyStatement(
        'WITH recent AS (SELECT * FROM logs ORDER BY ts DESC LIMIT 10) SELECT * FROM recent',
      ),
    ).toBe(true)
  })

  it('rejects a WITH-cte that ends in a write', () => {
    expect(
      isReadOnlyStatement(
        'WITH doomed AS (SELECT id FROM t WHERE stale) DELETE FROM t WHERE id IN (SELECT id FROM doomed)',
      ),
    ).toBe(false)
    expect(isReadOnlyStatement('WITH x AS (SELECT 1) INSERT INTO logs SELECT * FROM x')).toBe(false)
    expect(isReadOnlyStatement('WITH x AS (SELECT 1) UPDATE t SET a = 1')).toBe(false)
  })

  it('strips leading comments before classifying', () => {
    expect(isReadOnlyStatement('-- just a peek\nSELECT * FROM t')).toBe(true)
    expect(isReadOnlyStatement('/* block */ SELECT 1')).toBe(true)
    // A comment must not hide the real (write) statement.
    expect(isReadOnlyStatement('-- SELECT 1\nDELETE FROM t')).toBe(false)
  })

  it('is not fooled by write keywords inside string literals', () => {
    expect(isReadOnlyStatement("SELECT * FROM t WHERE note = 'please delete this later'")).toBe(
      true,
    )
    expect(isReadOnlyStatement('SELECT * FROM t WHERE label = "insert here"')).toBe(true)
  })

  it('rejects INSERT/UPDATE/DELETE and DDL', () => {
    expect(isReadOnlyStatement('INSERT INTO t (a) VALUES (1)')).toBe(false)
    expect(isReadOnlyStatement('UPDATE t SET a = 1 WHERE id = 2')).toBe(false)
    expect(isReadOnlyStatement('DELETE FROM t')).toBe(false)
    expect(isReadOnlyStatement('REPLACE INTO t (a) VALUES (1)')).toBe(false)
    expect(isReadOnlyStatement('CREATE TABLE t (id INTEGER)')).toBe(false)
    expect(isReadOnlyStatement('ALTER TABLE t ADD COLUMN c TEXT')).toBe(false)
    expect(isReadOnlyStatement('DROP TABLE t')).toBe(false)
    expect(isReadOnlyStatement('TRUNCATE TABLE t')).toBe(false)
    expect(isReadOnlyStatement('GRANT SELECT ON t TO bob')).toBe(false)
    expect(isReadOnlyStatement('SELECT * INTO backup FROM t')).toBe(false)
    expect(isReadOnlyStatement('EXPLAIN ANALYZE DELETE FROM t')).toBe(false)
    expect(isReadOnlyStatement('EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET a = 1')).toBe(false)
    expect(isReadOnlyStatement('EXPLAIN INSERT INTO t VALUES (1)')).toBe(false)
  })

  it('reads replace()/copy()/load columns as calls and qualified columns, not writes', () => {
    expect(isReadOnlyStatement("SELECT replace(name, 'a', 'b') FROM t")).toBe(true)
    expect(isReadOnlyStatement('SELECT REPLACE (name, x, y) FROM t')).toBe(true)
    expect(isReadOnlyStatement('SELECT m.load, m.copy, m.import FROM metrics m')).toBe(true)
    // The write forms of the same words stay blocked, in every position.
    expect(isReadOnlyStatement('REPLACE t VALUES (1)')).toBe(false)
    expect(isReadOnlyStatement('EXPLAIN REPLACE t VALUES (1)')).toBe(false)
    expect(isReadOnlyStatement('EXPLAIN REPLACE INTO t (a) VALUES (1)')).toBe(false)
    expect(isReadOnlyStatement("SELECT replace(a, 'x', 'y') FROM t; DELETE FROM t")).toBe(false)
    expect(isReadOnlyStatement("SELECT 1; COPY t FROM '/tmp/x'")).toBe(false)
    expect(isReadOnlyStatement("SELECT 1; LOAD DATA INFILE 'x' INTO TABLE t")).toBe(false)
    expect(isReadOnlyStatement('SELECT load FROM metrics')).toBe(false)
    expect(isReadOnlyStatement("SELECT load_extension('/tmp/x.so')")).toBe(false)
  })

  it('rejects a T-SQL statement that follows a read in a separator-less batch', () => {
    for (const batch of [
      'SELECT 1 KILL 53',
      'SELECT 1 DENY SELECT ON dbo.t TO public',
      "SELECT 1 BACKUP DATABASE d TO DISK = N'x.bak'",
      "SELECT 1 RESTORE DATABASE d FROM DISK = N'x.bak'",
      'SELECT 1 SHUTDOWN WITH NOWAIT',
      'SELECT 1 RECONFIGURE',
      'SELECT 1 DBCC CHECKDB',
      'SELECT 1 CHECKPOINT',
      'SELECT 1 DISABLE TRIGGER trg ON dbo.t',
      'SELECT 1 ENABLE  TRIGGER ALL ON DATABASE',
      "SELECT 1 WRITETEXT t.c @ptr N'x'",
      "SELECT 1 UPDATETEXT t.c @ptr 0 NULL N'x'",
    ]) {
      expect(isReadOnlyStatement(batch)).toBe(false)
    }
  })

  it('keeps ordinary reads that use enable/disable as names', () => {
    expect(isReadOnlyStatement('SELECT enable, disable FROM settings WHERE enable = 1')).toBe(true)
    expect(isReadOnlyStatement('SELECT s.enable FROM settings s ORDER BY s.disable')).toBe(true)
    expect(isReadOnlyStatement("SELECT name FROM sys.triggers WHERE name = 'KILL'")).toBe(true)
  })

  it('distinguishes PRAGMA read from PRAGMA write forms', () => {
    expect(isReadOnlyStatement('PRAGMA table_info(users)')).toBe(true)
    expect(isReadOnlyStatement('PRAGMA journal_mode')).toBe(true)
    expect(isReadOnlyStatement('PRAGMA journal_mode = WAL')).toBe(false)
    expect(isReadOnlyStatement('PRAGMA foreign_keys=ON')).toBe(false)
  })

  it('treats a side-effecting PRAGMA as a write even with no value', () => {
    // FAIL-OPEN regression. The old rule was "a write iff it contains `=`", but a pragma
    // does not need a value to have a side effect. Verified against a real bun:sqlite DB:
    // `PRAGMA incremental_vacuum(100)` took the file from 1 740 800 B to 12 288 B, and
    // `PRAGMA optimize` created sqlite_stat1. A readonly connection rejects both.
    expect(isReadOnlyStatement('PRAGMA shrink_memory')).toBe(false)
    expect(isReadOnlyStatement('PRAGMA wal_checkpoint(TRUNCATE)')).toBe(false)
  })

  it('keeps the reporting PRAGMA forms readable', () => {
    // The allowlist must not cost the introspection the workbench actually runs.
    for (const read of [
      'PRAGMA table_info(users)',
      'PRAGMA table_xinfo(users)',
      'PRAGMA index_list(users)',
      'PRAGMA foreign_key_list(users)',
      'PRAGMA database_list',
      'PRAGMA integrity_check',
      'PRAGMA user_version',
      'PRAGMA page_count',
      'PRAGMA main.page_size', // the schema qualifier is not part of the name
    ]) {
      expect(isReadOnlyStatement(read)).toBe(true)
    }
  })

  it('classifies the whole input conservatively across multiple statements', () => {
    expect(isReadOnlyStatement('SELECT 1; SELECT 2')).toBe(true)
    expect(isReadOnlyStatement('SELECT 1; SELECT 2;')).toBe(true)
    // If ANY statement is a write, the whole input is a write.
    expect(isReadOnlyStatement('SELECT 1; DELETE FROM t')).toBe(false)
    expect(isReadOnlyStatement('SELECT * FROM t; UPDATE t SET a = 1')).toBe(false)
  })

  it('does not let a backslash in a literal hide a following write', () => {
    // FAIL-OPEN regression. `'\''` is a valid one-quote literal in MySQL/ClickHouse.
    // Stripping literals WITHOUT the backslash rule made the inner `''` look like an
    // escaped quote, so the scanner never found a close, ate the `;` and the whole
    // second statement, and the guard reported a pure read.
    expect(isReadOnlyStatement(String.raw`SELECT '\''; DROP TABLE t`)).toBe(false)
    expect(isReadOnlyStatement(String.raw`SELECT '\''; DELETE FROM t WHERE 1=1`)).toBe(false)
    expect(isReadOnlyStatement(String.raw`SELECT '\''; UPDATE t SET a=1`)).toBe(false)
    expect(isReadOnlyStatement(String.raw`SELECT '\''; INSERT INTO t VALUES (1)`)).toBe(false)
    // Same shape with a double-quoted identifier.
    expect(isReadOnlyStatement(String.raw`SELECT "\""; DROP TABLE t`)).toBe(false)
    // The mirror case, which the no-escape reading already rejected: under MySQL this is
    // ONE literal and a pure read, but proving that needs a dialect we do not know here,
    // so the conservative verdict stands.
    expect(isReadOnlyStatement(String.raw`SELECT 'a\'; DROP TABLE t; SELECT '`)).toBe(false)
  })

  it('does not let another supported dialect grammar hide a following write', () => {
    // PostgreSQL: the quote is data inside one dollar-quoted string. A scanner
    // unaware of dollar quoting opens a phantom single-quoted string and swallows DROP.
    expect(isReadOnlyStatement(`SELECT $$'$$ AS q; DROP TABLE t`)).toBe(false)
    expect(isReadOnlyStatement(`SELECT $tag$'$tag$ AS q; DELETE FROM t`)).toBe(false)

    // T-SQL: the quote is data inside a bracket identifier. Treating `[` as ordinary
    // code opens the same kind of phantom literal and hides the following statement.
    expect(isReadOnlyStatement(`SELECT * FROM [my'table]; DROP TABLE t`)).toBe(false)

    // MySQL executes version comments, and only treats `--` as a comment when whitespace
    // follows. Both were previously stripped as inert comments through end-of-line.
    expect(isReadOnlyStatement(`SELECT 1; /*!40000 DROP TABLE t */`)).toBe(false)
    expect(isReadOnlyStatement(`SELECT 1--2; DROP TABLE t`)).toBe(false)
  })

  it('treats a backslash literal as a read when no write is hidden either way', () => {
    // The dual reading must not reject ordinary SQL: with no write keyword reachable
    // under EITHER literal grammar, the verdict is still "read".
    expect(isReadOnlyStatement(String.raw`SELECT '\'' AS quote`)).toBe(true)
    expect(isReadOnlyStatement(String.raw`SELECT * FROM t WHERE p = 'C:\\path\\to'`)).toBe(true)
    expect(isReadOnlyStatement(String.raw`SELECT 'it\'s fine' FROM t`)).toBe(true)
  })

  it('rejects empty / comment-only / unknown input', () => {
    expect(isReadOnlyStatement('')).toBe(false)
    expect(isReadOnlyStatement('   ')).toBe(false)
    expect(isReadOnlyStatement('-- just a comment')).toBe(false)
    expect(isReadOnlyStatement('BEGIN')).toBe(false)
    expect(isReadOnlyStatement('SET search_path TO public')).toBe(false)
  })

  it('offers exact-dialect classification for driver transport routing', () => {
    // The guard must reject this ambiguous text because another dialect treats backticks
    // as ordinary code and sees DROP. ClickHouse knows they quote an identifier, so its
    // driver must still use the row-returning transport for this SELECT.
    expect(isReadOnlyStatement('SELECT `drop` FROM t')).toBe(false)
    expect(isReadOnlyStatementForDialect('SELECT `drop` FROM t', 'clickhouse')).toBe(true)
    expect(isReadOnlyStatementForDialect('DROP TABLE t', 'clickhouse')).toBe(false)
  })
})
