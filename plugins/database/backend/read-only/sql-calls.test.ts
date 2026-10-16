import { describe, expect, it } from 'bun:test'
import { isReadOnlyStatement } from './sql'
import { isSideEffectFreeStatement } from './sql-calls'

/**
 * Each LEAK is a statement the keyword classifier calls a read while the engine writes (or
 * kills, or locks) when it runs it. The first assertion of the table proves the leak is real
 * — `isReadOnlyStatement` passes it — so the table cannot rot into testing nothing.
 */
const LEAKS = [
  "SELECT nextval('orders_id_seq')",
  "SELECT setval('orders_id_seq', 1)",
  'SELECT lo_unlink(16401)',
  'SELECT pg_terminate_backend(4242)',
  'SELECT pg_cancel_backend(4242)',
  "SELECT dblink_exec('dbname=prod', 'DROP TABLE t')",
  'SELECT pg_advisory_lock(1)',
  "SELECT set_config('search_path', 'evil', false)",
  'SELECT txid_current()',
  'SELECT archive_old_orders()',
  'SELECT * FROM refresh_stats()',
  "SELECT id, nextval('s') AS next FROM t",
  'SELECT count(*) FROM t WHERE id = purge_one(t.id)',
  // a schema-qualified name resolves to that schema, not to the allowlisted built-in
  'SELECT public.lower(name) FROM t',
  // a quoted name is any function at all, whatever the masking does to it
  `SELECT "nextval"('s')`,
  'SELECT `get_lock`(1, 10)',
  "SELECT [dbo].[purge]('x')",
  // EXPLAIN ANALYZE executes its statement
  "EXPLAIN ANALYZE SELECT nextval('s')",
  "EXPLAIN (ANALYZE) SELECT setval('s', 1)",
  // the CTE-header and AS exemptions must not shelter a real call
  "WITH x AS (SELECT nextval('s')) SELECT * FROM x",
  "WITH nextval('s') AS n SELECT n",
  "SELECT * FROM dblink('dbname=prod', 'SELECT 1') AS (a int)",
  // a non-reserved grammar word is a user function anywhere but its own position
  'SELECT filter(1)',
  'SELECT over(1)',
  'SELECT top(1)',
  // a property of Object.prototype is not an allowlist entry
  'SELECT constructor(1)',
  'SELECT 1; SELECT nextval($$s$$)',
]

const READS = [
  'SELECT * FROM users',
  'SELECT u.id, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE o.total > 10',
  'SELECT count(*), sum(total), avg(total), min(ts), max(ts) FROM orders GROUP BY user_id',
  "SELECT coalesce(nickname, lower(name)), length(name) FROM users WHERE upper(city) = 'X'",
  "SELECT date_trunc('day', created_at) AS d, count(*) FROM t GROUP BY 1 ORDER BY 1",
  'SELECT now(), current_timestamp, random()',
  'SELECT CAST(price AS decimal(10, 2)), price::numeric(10, 2) FROM t',
  'SELECT * FROM t WHERE id IN (SELECT id FROM u) AND EXISTS (SELECT 1 FROM v)',
  'WITH recent AS (SELECT * FROM logs LIMIT 10) SELECT * FROM recent',
  'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT * FROM n',
  'WITH x AS MATERIALIZED (SELECT 1) SELECT * FROM x',
  'SELECT rank() OVER (PARTITION BY a ORDER BY b), count(*) FILTER (WHERE c) FROM t GROUP BY a, b',
  'SELECT a, b FROM t GROUP BY GROUPING SETS ((a), (b))',
  'SELECT * FROM generate_series(1, 3) AS g(i)',
  '(SELECT 1) UNION (SELECT 2)',
  'EXPLAIN SELECT * FROM t',
  'EXPLAIN ANALYZE SELECT * FROM t',
  'EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM t',
  'SHOW TABLES',
  'DESCRIBE users',
  'PRAGMA table_info(users)',
  "SELECT * FROM pragma_table_info('users')",
  'VALUES (1), (2)',
  'SELECT TOP 50 * FROM dbo.table_name',
  // a name inside a literal or comment is not a call
  "SELECT 'nextval(1)' AS label -- setval(2)",
  'SELECT * FROM "Orders" WHERE "Total" > 5',
]

describe('isSideEffectFreeStatement', () => {
  it('treats a function that can write as a write, though the keyword scan calls it a read', () => {
    for (const sql of LEAKS) {
      expect({ sql, keywordRead: isReadOnlyStatement(sql) }).toEqual({ sql, keywordRead: true })
      expect({ sql, read: isSideEffectFreeStatement(sql) }).toEqual({ sql, read: false })
    }
  })

  it('keeps the everyday reads readable', () => {
    for (const sql of READS) {
      expect({ sql, read: isSideEffectFreeStatement(sql) }).toEqual({ sql, read: true })
    }
  })

  it('never reads more than the keyword scan does', () => {
    for (const sql of ['DELETE FROM t', 'SELECT * INTO b FROM t', 'BEGIN', '', 'PRAGMA optimize']) {
      expect({ sql, read: isSideEffectFreeStatement(sql) }).toEqual({ sql, read: false })
    }
  })
})
