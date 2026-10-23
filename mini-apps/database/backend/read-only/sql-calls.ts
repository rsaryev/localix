import { scanSqlRegions, type SqlLiteralGrammar } from '../../shared/sql-regions'
import { isReadOnlyStatement, SQL_GRAMMAR_VARIANTS } from './sql'

/**
 * "Does this SELECT call anything that could write?" — the half of the read test that the
 * keyword classifier in `sql.ts` cannot see.
 *
 * The defect: `SELECT nextval('s')`, `SELECT setval('s', 1)`, `SELECT lo_unlink(1)`,
 * `SELECT pg_terminate_backend(42)`, `SELECT dblink_exec('…', 'DELETE …')`,
 * `SELECT txid_current()` and any user-defined volatile function are writes wearing a
 * SELECT. `isReadOnlyStatement` passes every one of them — its own neighbour
 * `server-guard.ts` says so — and a read-only plan session trusts that verdict to deny
 * every write, so each of these ran with no confirmation at all.
 *
 * What forces the shape: the verdict is needed on the permission path, pure and synchronous,
 * before a connection is resolved, so the function's volatility cannot be looked up. The
 * only sound rule left is an ALLOWLIST: a call is accepted only when its name is a built-in
 * known to have no side effect in the engines this workbench supports (non-deterministic is
 * fine — `now()` and `random()` change nothing). Every other call — an unknown name, a
 * schema-qualified name (`public.lower(…)` may be a user overload), a quoted name
 * (`"nextval"(…)`) — makes the statement a write. An omission costs the user one
 * confirmation; an over-inclusion costs them a write they were promised would not happen.
 *
 * Known residue, deliberately not chased: a user-defined OPERATOR backed by a volatile
 * function, and Postgres's attribute notation `t.f` for `f(t)`. Neither is a call this
 * text can distinguish from a column, and both need the user to have built the trap first.
 */

/** Built-ins with no side effect, lower-case. Grouped only for the reader. */
const PURE_FUNCTIONS = new Set(
  [
    // aggregates and window functions (standard + common dialect spellings)
    'count sum avg min max total group_concat string_agg array_agg json_agg jsonb_agg listagg',
    'bool_and bool_or every stddev stddev_samp stddev_pop variance var_samp var_pop median mode',
    'percentile_cont percentile_disc row_number rank dense_rank ntile lag lead first_value',
    'last_value nth_value percent_rank cume_dist grouping rollup cube',
    // null handling and conditionals
    'coalesce nullif ifnull isnull nvl greatest least if iif choose multiif',
    // strings
    'lower upper length char_length character_length octet_length len datalength substr',
    'substring trim ltrim rtrim btrim concat concat_ws left right position strpos instr',
    'charindex patindex lpad rpad reverse repeat replicate split_part regexp_replace',
    'regexp_matches regexp_like regexp_substr initcap format printf quote stuff space str',
    'md5 hex unhex encode decode char chr ascii unicode to_hex',
    // numbers
    'abs round ceil ceiling floor trunc mod power pow sqrt exp ln log log10 log2 sign pi',
    'random rand',
    // casts and type constructors (also the type names a cast target may carry)
    'cast try_cast convert try_convert numeric decimal varchar nvarchar nchar varbinary binary',
    'float real double int integer bigint smallint text bool boolean row array map tuple',
    // date and time
    'now current_date current_time current_timestamp localtime localtimestamp getdate',
    'getutcdate sysdatetime date time datetime timestamp julianday strftime unixepoch age',
    'date_trunc date_part extract to_char to_date to_timestamp to_number date_format',
    'str_to_date datediff dateadd datepart datename date_add date_sub timestampdiff eomonth',
    'year month day hour minute second interval make_date make_timestamp',
    // json
    'json json_extract json_object json_array json_build_object jsonb_build_object',
    'json_build_array to_json to_jsonb row_to_json json_each json_tree jsonb_each',
    'jsonb_array_elements json_array_elements json_array_length json_typeof json_valid',
    // set-returning and table-valued readers
    'generate_series unnest array_length cardinality',
    'pragma_table_info pragma_table_xinfo pragma_index_list pragma_foreign_key_list',
    // introspection that only reports
    'version typeof pg_typeof current_setting current_database current_schema database',
    'schema db_name schema_name object_id object_name sqlite_version',
    // clickhouse spellings of the above
    'uniq uniqexact countif sumif avgif any argmax argmin grouparray quantile quantiles',
    'todate todatetime tostring toint64 touint64 tofloat64 tostartofday tostartofhour',
    'tostartofmonth toyyyymm formatreadablesize empty notempty has',
    // sampling methods (`TABLESAMPLE SYSTEM (10)`)
    'system bernoulli',
  ]
    .join(' ')
    .split(/\s+/),
)

/**
 * Words that are grammar, not calls, when a `(` follows them: `IN (…)`, `EXISTS (…)`,
 * `AS (…)` (a CTE body), `VALUES (…)`, `UNION (SELECT …)`. Only RESERVED words belong here —
 * a non-reserved one (Postgres's `match`, `top`, `option`, `range`) can name a user function,
 * and listing it would wave that function through. Such grammar (`SELECT TOP (10)`,
 * `MATCH … AGAINST (…)`) classifies as a write instead: a confirmation, never a hole.
 */
const GRAMMAR_WORDS = new Set(
  [
    'select from where and or not in exists any all some as on using join values with by',
    'order having union intersect except lateral case when then else is like ilike between',
    'distinct group to table',
  ]
    .join(' ')
    .split(/\s+/),
)

/**
 * Non-reserved grammar words, accepted ONLY in their one grammatical position — the test
 * receives the code before the word, trimmed. `count(*) FILTER (WHERE …)` and
 * `rank() OVER (…)` follow a `)`; `GROUPING SETS (…)` follows GROUPING;
 * `AS [NOT] MATERIALIZED (…)` follows AS/NOT; `EXPLAIN (ANALYZE)` opens a statement.
 * Anywhere else the same word is a call to a user function of that name. A Map, not an
 * object literal: `constructor(…)` must not find `Object.prototype.constructor` and pass.
 */
const POSITIONAL_WORDS = new Map<string, (before: string) => boolean>([
  ['filter', (before) => before.endsWith(')')],
  ['over', (before) => before.endsWith(')')],
  ['sets', (before) => /\bGROUPING$/i.test(before)],
  ['materialized', (before) => /\b(?:AS|NOT)$/i.test(before)],
  ['explain', (before) => /^[\s(]*$/.test(before)],
])

const CALL_RE = /(?<![\p{L}\p{N}_$])([\p{L}_][\p{L}\p{N}_$]*)\s*\(/gu
const LAST_WORD_RE = /([\p{L}_][\p{L}\p{N}_$]*)$/u
const FIRST_WORD_RE = /^[\s(]*([A-Za-z_][A-Za-z0-9_]*)/

/**
 * The code with every non-code region blanked — except that a QUOTED IDENTIFIER becomes a
 * run of `q`. Blanking it would turn `SELECT "nextval"('s')` into `SELECT        ('s')`, and
 * the `(` would then look like it follows `SELECT`; as `qqqqqqqqq(` it is a call to a name
 * no allowlist holds. Length is preserved so offsets stay meaningful.
 */
function callableCode(sql: string, grammar: SqlLiteralGrammar): string {
  const chars = sql.split('')
  for (const region of scanSqlRegions(sql, grammar)) {
    const fill = region.kind === 'identifier' ? 'q' : ' '
    for (let index = region.start; index < region.end; index++) {
      if (chars[index] !== '\n') chars[index] = fill
    }
  }
  return chars.join('')
}

/** Offset just past the `)` that closes the `(` at `open`, or the end of the text. */
function closingParen(code: string, open: number): number {
  let depth = 0
  for (let index = open; index < code.length; index++) {
    if (code[index] === '(') depth++
    else if (code[index] === ')' && --depth === 0) return index + 1
  }
  return code.length
}

/**
 * Is the name before `(` at `open` NOT a call — a column list or a type modifier?
 *  - `x::numeric(10,2)` and `CAST(x AS decimal(10,2))`, `FROM t AS t2(a, b)`: a type or an
 *    alias follows `::`/`AS`, never a function.
 *  - `WITH [RECURSIVE] cte(a, b) AS (…)`: a CTE column list — but ONLY when `AS (` or
 *    `AS [NOT] MATERIALIZED` follows. ClickHouse's `WITH f(x) AS alias` is a real call in the
 *    same position, and Postgres's `FROM dblink(…) AS (a int)` is one after `FROM`.
 */
function isColumnListOrType(code: string, nameStart: number, open: number): boolean {
  const before = code.slice(0, nameStart).trimEnd()
  if (before.endsWith('::')) return true
  const previous = LAST_WORD_RE.exec(before)?.[1]?.toLowerCase()
  if (previous === 'as') return true
  if (previous !== 'with' && previous !== 'recursive') return false
  const after = code.slice(closingParen(code, open)).trimStart()
  return /^AS\s*(?:\(|MATERIALIZED\b|NOT\s+MATERIALIZED\b)/i.test(after)
}

/** Every call in one statement's code names a known side-effect-free built-in. */
function statementCallsArePure(code: string): boolean {
  for (const match of code.matchAll(CALL_RE)) {
    const name = match[1]!.toLowerCase()
    const nameStart = match.index!
    const open = nameStart + match[0].length - 1
    const before = code.slice(0, nameStart).trimEnd()
    // `public.lower(…)` resolves to whatever that schema defines, not the built-in.
    if (before.endsWith('.')) return false
    if (GRAMMAR_WORDS.has(name)) continue
    if (POSITIONAL_WORDS.get(name)?.(before)) continue
    if (isColumnListOrType(code, nameStart, open)) continue
    if (!PURE_FUNCTIONS.has(name)) return false
  }
  return true
}

function callsArePureUnder(sql: string, grammar: SqlLiteralGrammar): boolean {
  return callableCode(sql, grammar)
    .split(';')
    .filter((statement) => statement.trim().length > 0)
    .every(
      (statement) =>
        // `PRAGMA table_info(users)` is not a call; `sql.ts` already allowlists pragmas.
        FIRST_WORD_RE.exec(statement)?.[1]?.toUpperCase() === 'PRAGMA' ||
        statementCallsArePure(statement),
    )
}

/**
 * True only when `sql` is a read by the keyword rules of `isReadOnlyStatement` AND every
 * function it calls is an allowlisted built-in, under EVERY supported literal grammar (the
 * same intersection `sql.ts` uses, for the same reason: the dialect is unknown here).
 *
 * `EXPLAIN ANALYZE` executes its statement, so it is judged by that inner statement — which
 * this does by scanning the whole text: `EXPLAIN ANALYZE SELECT nextval('s')` is a write.
 * A plain `EXPLAIN` gets the same scan, because MySQL's EXPLAIN has historically executed
 * derived tables; the cost is a confirmation, never a missed write.
 */
export function isSideEffectFreeStatement(sql: string): boolean {
  return (
    isReadOnlyStatement(sql) &&
    SQL_GRAMMAR_VARIANTS.every((grammar) => callsArePureUnder(sql, grammar))
  )
}
