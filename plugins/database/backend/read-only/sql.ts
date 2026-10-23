import {
  CLICKHOUSE_SQL_GRAMMAR,
  maskSqlNonCode,
  MSSQL_SQL_GRAMMAR,
  MYSQL_SQL_GRAMMAR,
  POSTGRES_SQL_GRAMMAR,
  SQLITE_SQL_GRAMMAR,
  sqlGrammarForDialect,
  type SqlLiteralGrammar,
} from '../../shared/sql-regions'
import type { DbDialect } from '../../shared/driver-catalog'

/**
 * Pure, dialect-agnostic read-only SQL classifier used by the read-only connection
 * guard-rail. `isReadOnlyStatement(sql)` answers a deliberately conservative question:
 * "is this input DEFINITELY only reading data?" — anything it cannot prove is a pure
 * read is treated as a write (returns `false`), so the guard fails safe.
 *
 * It is NOT a security boundary — a full SQL parser is out of scope and a determined
 * user can still write through other means. It exists to stop *accidental* writes on a
 * connection the user marked read-only, with an explicit server-side check rather than a
 * client-only affordance.
 *
 * Rules (all statements in the input must pass; if ANY is a write, the whole input is a
 * write):
 *  - comments, string literals and quoted identifiers are masked first, so a keyword
 *    hiding inside a string never trips the scan. The masking runs once per SUPPORTED
 *    DIALECT GRAMMAR and every reading must agree — see {@link isReadOnlyStatement};
 *  - the first keyword must be a read starter (SELECT/WITH/EXPLAIN/SHOW/PRAGMA/
 *    DESCRIBE/DESC/VALUES/TABLE);
 *  - a read starter can still hide a write (`WITH … DELETE`, `EXPLAIN INSERT`,
 *    `SELECT … INTO`), so the statement is also scanned for any top-level write keyword;
 *  - a `PRAGMA` is a read only when it is on the ALLOWLIST of reporting pragmas — a value
 *    is not required for a pragma to have a side effect (`PRAGMA optimize` writes), so
 *    "contains `=`" is not a sufficient test. See {@link isReadOnlyPragma}.
 */

/** Keywords a pure-read statement may start with. */
const READ_STARTERS = new Set([
  'SELECT',
  'WITH',
  'EXPLAIN',
  'SHOW',
  'PRAGMA',
  'DESCRIBE',
  'DESC',
  'VALUES',
  'TABLE', // postgres `TABLE foo` ≡ `SELECT * FROM foo`
])

/**
 * Write keywords that can appear AFTER a legal read starter and turn the whole
 * statement into a write (a CTE that ends in a DML, `SELECT … INTO newtable`, an
 * `EXPLAIN` of a write, …). A statement that merely *starts* with a non-read keyword is
 * already rejected by the starter check, so this list only needs the "hidden write"
 * cases — but a broad DML/DDL set here is harmless and defensive.
 */
const WRITE_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'MERGE',
  'UPSERT',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'CALL',
  'EXECUTE',
  'EXEC',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'INTO', // `SELECT … INTO newtable` materializes a table
  'COPY',
  'LOAD',
  'IMPORT',
  'LOAD_EXTENSION', // SQLite `load_extension(...)` loads native code
  // T-SQL runs a batch without `;` separators, so each reserved statement word that changes
  // server state can follow a read: `SELECT 1 KILL 53`.
  'KILL',
  'DENY',
  'BACKUP',
  'RESTORE',
  'SHUTDOWN',
  'RECONFIGURE',
  'DBCC',
  'CHECKPOINT',
  'WRITETEXT',
  'UPDATETEXT',
  // ENABLE/DISABLE are not reserved and are common column names; only the trigger statement writes.
  '(?:ENABLE|DISABLE)\\s+TRIGGER',
]

const WRITE_KEYWORD_RE = new RegExp(`\\b(?:${WRITE_KEYWORDS.join('|')})\\b`, 'g')

/**
 * Write keywords that are ALSO ordinary function or column names inside a read: `replace(s, a, b)`
 * exists in every supported engine, and `load`/`copy` are common column names. As writes, each is
 * only ever a statement STARTER (`REPLACE [INTO] tbl`, `COPY tbl`, `LOAD DATA`, `IMPORT TABLE`) —
 * none of them is written `KEYWORD(` and none is reached through a `.` qualifier, so those two
 * spellings are a call and a qualified column. A bare `load` column stays blocked: T-SQL runs
 * statements without separators, so a bare word is not provably not a starter.
 */
const CALLABLE_WRITE_KEYWORDS = new Set(['REPLACE', 'COPY', 'LOAD', 'IMPORT'])

function hidesWrite(upper: string): boolean {
  for (const match of upper.matchAll(WRITE_KEYWORD_RE)) {
    const keyword = match[0]
    if (CALLABLE_WRITE_KEYWORDS.has(keyword)) {
      const before = upper.slice(0, match.index).trimEnd()
      const after = upper.slice(match.index + keyword.length).trimStart()
      if (after.startsWith('(') || before.endsWith('.')) continue
    }
    return true
  }
  return false
}

/**
 * The DISTINCT literal grammars across the SQL engines this workbench supports. The
 * classifier does not know which dialect a query is for, and the readings genuinely
 * disagree about where a literal ends — so it evaluates every one of them.
 *
 * There is one entry per distinct flag combination. PostgreSQL has its own shape;
 * the other supported engines each differ in at least one relevant rule.
 */
export const SQL_GRAMMAR_VARIANTS: readonly SqlLiteralGrammar[] = [
  SQLITE_SQL_GRAMMAR,
  POSTGRES_SQL_GRAMMAR,
  MYSQL_SQL_GRAMMAR,
  CLICKHOUSE_SQL_GRAMMAR,
  MSSQL_SQL_GRAMMAR,
]

/**
 * SQLite pragmas that only ever REPORT, in bare or `(argument)` form — the introspection
 * family. `PRAGMA table_info(users)` is a read precisely BECAUSE it takes an argument.
 */
const REPORT_ONLY_PRAGMAS = new Set([
  'collation_list',
  'compile_options',
  'database_list',
  'foreign_key_check',
  'foreign_key_list',
  'function_list',
  'index_info',
  'index_list',
  'index_xinfo',
  'integrity_check',
  'module_list',
  'pragma_list',
  'quick_check',
  'table_info',
  'table_list',
  'table_xinfo',
])

/**
 * Pragmas that report their current value when BARE and set it when given one. SQLite
 * accepts `PRAGMA x = v` and `PRAGMA x(v)` interchangeably, so the paren form is a write
 * here — the opposite of the introspection family above.
 */
const REPORT_WHEN_BARE_PRAGMAS = new Set([
  'application_id',
  'auto_vacuum',
  'busy_timeout',
  'cache_size',
  'cache_spill',
  'data_version',
  'defer_foreign_keys',
  'encoding',
  'freelist_count',
  'foreign_keys',
  'journal_mode',
  'journal_size_limit',
  'locking_mode',
  'max_page_count',
  'mmap_size',
  'page_count',
  'page_size',
  'recursive_triggers',
  'schema_version',
  'secure_delete',
  'synchronous',
  'temp_store',
  'user_version',
  'wal_autocheckpoint',
])

/**
 * Is this `PRAGMA …` a pure read?
 *
 * The old rule — "a write iff it contains `=`" — let two measured writes through, because a
 * pragma can have a side effect with no value at all: `PRAGMA optimize` creates/updates
 * `sqlite_stat1`, and `PRAGMA incremental_vacuum(100)` rewrites the file (verified against a
 * real database: 1 740 800 B down to 12 288 B, and a readonly connection rejects it with
 * "attempt to write a readonly database").
 *
 * There is no way to enumerate every future pragma, so this follows the module's own rule
 * and ALLOWLISTS the ones known to report. Anything unrecognised is treated as a write.
 */
function isReadOnlyPragma(trimmed: string): boolean {
  // `PRAGMA main.page_size` — the optional schema qualifier is not part of the name.
  const match =
    /^PRAGMA\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/is.exec(trimmed)
  if (!match) return false
  const name = match[1]!.toLowerCase()
  const rest = match[2]!.trim()
  if (REPORT_ONLY_PRAGMAS.has(name)) return true
  return REPORT_WHEN_BARE_PRAGMAS.has(name) && rest.length === 0
}

/** Classify a single (already comment/string-stripped) statement. */
function isReadOnlySingle(stmt: string): boolean {
  // Drop any leading parentheses/whitespace so `(SELECT …)` reads as a SELECT.
  const trimmed = stmt.replace(/^[\s(]+/, '')
  const upper = trimmed.toUpperCase()
  const first = /^[A-Z_][A-Z0-9_]*/.exec(upper)?.[0]
  if (!first || !READ_STARTERS.has(first)) return false
  if (first === 'PRAGMA') return isReadOnlyPragma(trimmed)
  // A read starter can still hide a write further along the statement.
  if (hidesWrite(upper)) return false
  return true
}

/** Mask literals/comments once and split into non-empty statements. */
function maskedStatements(sql: string, grammar: SqlLiteralGrammar): string[] {
  return maskSqlNonCode(sql, grammar)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function everyStatementReads(sql: string, grammar: SqlLiteralGrammar): boolean {
  const statements = maskedStatements(sql, grammar)
  return statements.length > 0 && statements.every(isReadOnlySingle)
}

/**
 * True only if EVERY statement in `sql` is a pure read. Conservative: an empty /
 * comment-only input, an unrecognized leading keyword, or any hidden write anywhere
 * yields `false`.
 *
 * "Strip the literals first" has NO dialect-agnostic answer, and this classifier does not
 * know the dialect. Every difference below was a measured fail-open, each one a valid
 * statement that a supported engine executes as a write while the guard called it a read:
 *
 *   SELECT '\''; DROP TABLE t              MySQL/ClickHouse read `\'` as an escaped quote.
 *                                          Without that rule the inner `''` looked like an
 *                                          escape, no close was found, and the `;` plus the
 *                                          whole second statement were swallowed.
 *   SELECT $$'$$ AS q; DROP TABLE t        Postgres dollar-quoting was not handled at
 *                                          all, so the `'` inside opened a phantom literal.
 *   SELECT * FROM [my'table]; DROP TABLE t T-SQL `[ident]` was not handled, same mechanism.
 *   SELECT 1; /*!40000 DROP TABLE t *\/     MySQL EXECUTES `/*! … *\/`; treating it as inert
 *                                          hid a real statement.
 *   SELECT 1--2; DROP TABLE t              MySQL needs whitespace after `--`, so `--2` is
 *                                          minus-minus-two, not a comment to end of line.
 *
 * Picking any single reading is demonstrably unsafe in some other engine's dialect, so
 * classify under EVERY grammar the workbench supports and require them all to agree. The
 * verdict is the intersection: strictly more conservative than any one reading, never less.
 *
 * Cost is linear in the number of variants (measured: ~2x per extra variant, well under a
 * millisecond on any realistic paste), and inputs containing none of the ambiguous
 * constructs — the overwhelming majority — mask identically under all of them.
 */
export function isReadOnlyStatement(sql: string): boolean {
  return SQL_GRAMMAR_VARIANTS.every((grammar) => everyStatementReads(sql, grammar))
}

/**
 * Exact-dialect classification for INTERNAL driver decisions where false negatives are
 * harmful (for example ClickHouse choosing its row-returning `query()` transport).
 *
 * Do not use this in the dialect-agnostic read-only connection guard above: that boundary
 * intentionally intersects every supported reading because its caller only knows "SQL".
 */
export function isReadOnlyStatementForDialect(sql: string, dialect: DbDialect): boolean {
  return everyStatementReads(sql, sqlGrammarForDialect(dialect))
}

/**
 * Exactly ONE statement, and it only reads. A server-side cursor (Postgres's row-limited
 * Execute) runs on the extended protocol, which refuses a multi-statement text — so the result
 * row cap may stop a query early only when this holds.
 */
export function isSingleReadStatementForDialect(sql: string, dialect: DbDialect): boolean {
  const statements = maskedStatements(sql, sqlGrammarForDialect(dialect))
  return statements.length === 1 && isReadOnlySingle(statements[0]!)
}
