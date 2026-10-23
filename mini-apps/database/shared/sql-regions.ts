import type { DbDialect } from './driver-catalog'

/**
 * ONE literal/comment scanner for SQL, parameterized by the parts of the grammar that
 * genuinely differ between the engines this workbench supports.
 *
 * It exists because the same scan was hand-rolled per call site and the copies drifted
 * into real data bugs: the ClickHouse binder bound a `?` that sat inside an escaped
 * string literal, and the MSSQL binder did a bare `text.replace(/\?/g, …)` with no scan
 * at all, quietly putting a parameter value INSIDE a string literal and handing the real
 * placeholder a value that did not exist.
 *
 * Every flag below is required by a documented engine grammar, and setting it wrongly
 * produces a specific reproducible defect — none of them is a "just in case" knob:
 *
 *  - `backslashEscapes`: MySQL and ClickHouse read `\'` as an escaped quote (ClickHouse
 *    lexes all three quote characters through one routine that consumes `\` + the next
 *    character). T-SQL and standard-conforming Postgres read the backslash literally and
 *    let that quote CLOSE the string, so the flag must be OFF there or the scanner runs
 *    past the end of the literal and hides real code.
 *  - `bracketIdentifiers`: `[ident]` (with `]]` doubling) is a quoted identifier in T-SQL
 *    and SQLite. In ClickHouse `[…]` is an ARRAY literal whose contents ARE code, so
 *    skipping it there would drop a legitimate `?` inside `SELECT [?, ?]`.
 *  - `backtickIdentifiers`: MySQL and ClickHouse quote identifiers with backticks (doubled
 *    to escape). T-SQL has no backtick at all.
 *  - `dollarQuotes`: `$tag$…$tag$` is a string in Postgres and nothing at all
 *    elsewhere.
 *  - `executableComments`: MySQL EXECUTES `/*! … *\/` (and `/*!50000 … *\/`). Treating it as
 *    an inert comment hides real statements from anything that scans the code.
 *  - `lineCommentRequiresSpace`: MySQL only starts a comment at `--` when a whitespace
 *    character follows; `1--2` is minus-minus-two. Treating a bare `--` as a comment there
 *    swallows the rest of the line, including a `;`.
 *  - `hashLineComments`: MySQL and ClickHouse accept `# …` to end of line.
 *  - `nestedBlockComments`: PostgreSQL and T-SQL match nested `/* … *\/` pairs.
 *  - `prefixedBackslashStrings`: PostgreSQL only enables C-style backslash escaping
 *    for an `E'…'` string, rather than for every ordinary string.
 */
export interface SqlLiteralGrammar {
  backslashEscapes: boolean
  bracketIdentifiers: boolean
  backtickIdentifiers: boolean
  dollarQuotes: boolean
  executableComments: boolean
  lineCommentRequiresSpace: boolean
  hashLineComments: boolean
  nestedBlockComments: boolean
  prefixedBackslashStrings: boolean
}

/** SQLite accepts standard strings plus both bracket- and backtick-quoted identifiers. */
export const SQLITE_SQL_GRAMMAR: SqlLiteralGrammar = {
  backslashEscapes: false,
  bracketIdentifiers: true,
  backtickIdentifiers: true,
  dollarQuotes: false,
  executableComments: false,
  lineCommentRequiresSpace: false,
  hashLineComments: false,
  nestedBlockComments: false,
  prefixedBackslashStrings: false,
}

/** PostgreSQL: dollar/E strings, nested block comments, standard identifiers. */
export const POSTGRES_SQL_GRAMMAR: SqlLiteralGrammar = {
  backslashEscapes: false,
  bracketIdentifiers: false,
  backtickIdentifiers: false,
  dollarQuotes: true,
  executableComments: false,
  lineCommentRequiresSpace: false,
  hashLineComments: false,
  nestedBlockComments: true,
  prefixedBackslashStrings: true,
}

/** MySQL: backslash strings, backticks, # comments and executable version comments. */
export const MYSQL_SQL_GRAMMAR: SqlLiteralGrammar = {
  backslashEscapes: true,
  bracketIdentifiers: false,
  backtickIdentifiers: true,
  dollarQuotes: false,
  executableComments: true,
  lineCommentRequiresSpace: true,
  hashLineComments: true,
  nestedBlockComments: false,
  prefixedBackslashStrings: false,
}

/** T-SQL: `''` doubling, `[bracket]` identifiers and nested comments, no backslash escape. */
export const MSSQL_SQL_GRAMMAR: SqlLiteralGrammar = {
  backslashEscapes: false,
  bracketIdentifiers: true,
  backtickIdentifiers: false,
  dollarQuotes: false,
  executableComments: false,
  lineCommentRequiresSpace: false,
  hashLineComments: false,
  nestedBlockComments: true,
  prefixedBackslashStrings: false,
}

/** ClickHouse: `\'` and `''`, backtick identifiers, and `[…]` is an array literal (code). */
export const CLICKHOUSE_SQL_GRAMMAR: SqlLiteralGrammar = {
  backslashEscapes: true,
  bracketIdentifiers: false,
  backtickIdentifiers: true,
  dollarQuotes: false,
  executableComments: false,
  lineCommentRequiresSpace: false,
  hashLineComments: true,
  nestedBlockComments: false,
  prefixedBackslashStrings: false,
}

/**
 * The grammar to scan with when the goal is REDACTION and the dialect is unknown.
 *
 * Redaction is asymmetric: treating code as a string over-redacts (loses a little query
 * shape), while treating a string as code LEAKS its contents. So this is deliberately the
 * most string-greedy reading — backslash escapes on, dollar-quoting on — with
 * `bracketIdentifiers` OFF so a `[…]` region can never swallow (and thereby preserve) a
 * string literal sitting inside it.
 *
 * `executableComments` stays OFF here on purpose: removing a `/*! … *\/` body wholesale
 * cannot leak, whereas treating it as code only preserves query shape. Redaction has no
 * reason to take that trade.
 */
export const REDACTION_SQL_GRAMMAR: SqlLiteralGrammar = {
  backslashEscapes: true,
  bracketIdentifiers: false,
  backtickIdentifiers: true,
  dollarQuotes: true,
  executableComments: false,
  lineCommentRequiresSpace: false,
  hashLineComments: true,
  nestedBlockComments: true,
  prefixedBackslashStrings: true,
}

/** Exact lexer shape for every SQL dialect exposed by the driver catalog. */
export function sqlGrammarForDialect(dialect: DbDialect): SqlLiteralGrammar {
  switch (dialect) {
    case 'sqlite':
      return SQLITE_SQL_GRAMMAR
    case 'postgres':
      return POSTGRES_SQL_GRAMMAR
    case 'mysql':
      return MYSQL_SQL_GRAMMAR
    case 'mssql':
      return MSSQL_SQL_GRAMMAR
    case 'clickhouse':
      return CLICKHOUSE_SQL_GRAMMAR
    case 'redis':
    case 'mongodb':
    case 'elasticsearch':
      // Non-SQL engines do not call the SQL scanner. Keep a fail-safe fallback for a
      // future caller so unknown syntax is masked rather than exposed as code.
      return REDACTION_SQL_GRAMMAR
  }
}

export type SqlRegionKind = 'string' | 'dollar-string' | 'identifier' | 'comment'

export interface SqlRegion {
  /** Inclusive start offset in the source. */
  start: number
  /** Exclusive end offset in the source. */
  end: number
  kind: SqlRegionKind
}

/**
 * Replace every non-code region — string literals, quoted identifiers, `--` line comments
 * and `/* *\/` block comments — with spaces, preserving newlines and, critically, LENGTH:
 * offsets into the result are offsets into `sql`.
 *
 * The array is built with `split('')`, i.e. UTF-16 code UNITS, because every offset here
 * comes from `sql[i]` / `sql.length`. Spreading (`[...sql]`) iterates code POINTS and
 * collapses each surrogate pair into one slot, so a single emoji anywhere upstream shifts
 * every later offset and the blanking lands on real code.
 */
export function maskSqlNonCode(sql: string, grammar: SqlLiteralGrammar): string {
  const masked = sql.split('')
  for (const region of scanSqlRegions(sql, grammar)) {
    for (let index = region.start; index < region.end; index++) {
      if (masked[index] !== '\n') masked[index] = ' '
    }
  }
  return masked.join('')
}

/**
 * ONE left-to-right walk yielding every non-code region in source order.
 *
 * Single-pass is the point, not an optimization. Doing this as a sequence of independent
 * regex passes — strip comments, then strip literals — is unsound in both directions: a
 * `--` inside a string literal is not a comment, and stripping it first truncates the
 * literal so the later literal pass no longer matches it. That is a measured secret leak,
 * not a theoretical one (see recent-query-context.ts).
 */
export function scanSqlRegions(sql: string, grammar: SqlLiteralGrammar): SqlRegion[] {
  const regions: SqlRegion[] = []
  /** Consume a `close`-delimited region that escapes by doubling (and maybe by `\`). */
  const skipQuoted = (from: number, close: string): number => {
    const prefix = sql[from - 1]
    const beforePrefix = sql[from - 2]
    const prefixedEscape =
      close === "'" &&
      grammar.prefixedBackslashStrings &&
      (prefix === 'E' || prefix === 'e') &&
      (beforePrefix === undefined || !/[A-Za-z0-9_$]/.test(beforePrefix))
    const backslashEscapes = grammar.backslashEscapes || prefixedEscape
    let index = from + 1
    while (index < sql.length) {
      if (sql[index] === close) {
        // A doubled delimiter is an escaped one, not the end of the region.
        if (sql[index + 1] === close) {
          index += 2
          continue
        }
        return index + 1
      }
      index += backslashEscapes && sql[index] === '\\' && index + 1 < sql.length ? 2 : 1
    }
    return index
  }

  let index = 0
  while (index < sql.length) {
    const start = index
    const ch = sql[index]
    if (ch === "'") {
      index = skipQuoted(index, ch)
      regions.push({ start, end: index, kind: 'string' })
      continue
    }
    if (ch === '"' || (ch === '`' && grammar.backtickIdentifiers)) {
      index = skipQuoted(index, ch)
      regions.push({ start, end: index, kind: 'identifier' })
      continue
    }
    if (ch === '[' && grammar.bracketIdentifiers) {
      index = skipQuoted(index, ']')
      regions.push({ start, end: index, kind: 'identifier' })
      continue
    }
    if (ch === '-' && sql[index + 1] === '-') {
      const next = sql[index + 2]
      // MySQL: `--` only opens a comment when whitespace (or end of input) follows.
      const opensComment =
        !grammar.lineCommentRequiresSpace || next === undefined || /\s/.test(next)
      if (opensComment) {
        index += 2
        while (index < sql.length && sql[index] !== '\n') index++
        regions.push({ start, end: index, kind: 'comment' })
        continue
      }
      index += 2
      continue
    }
    if (ch === '#' && grammar.hashLineComments) {
      index++
      while (index < sql.length && sql[index] !== '\n') index++
      regions.push({ start, end: index, kind: 'comment' })
      continue
    }
    if (ch === '/' && sql[index + 1] === '*') {
      // MySQL executes `/*! … */`, so its body is CODE, not an inert comment. The
      // delimiters themselves are still skipped, not reported.
      const executable = grammar.executableComments && sql[index + 2] === '!'
      index += 2
      if (executable) continue
      let depth = 1
      while (index < sql.length && depth > 0) {
        if (grammar.nestedBlockComments && sql[index] === '/' && sql[index + 1] === '*') {
          depth++
          index += 2
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth--
          index += 2
        } else {
          index++
        }
      }
      regions.push({ start, end: index, kind: 'comment' })
      continue
    }
    if (ch === '$' && grammar.dollarQuotes) {
      const opener = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(index))?.[0]
      if (opener) {
        const close = sql.indexOf(opener, index + opener.length)
        index = close < 0 ? sql.length : close + opener.length
        regions.push({ start, end: index, kind: 'dollar-string' })
        continue
      }
    }
    index++
  }
  return regions
}

/**
 * Offsets of every `?` that is real CODE — the placeholders a driver may bind. A `?` inside
 * a literal, a quoted identifier or a comment is data and must be left exactly as it is.
 */
export function findQuestionPlaceholders(sql: string, grammar: SqlLiteralGrammar): number[] {
  const code = maskSqlNonCode(sql, grammar)
  const offsets: number[] = []
  for (let index = 0; index < code.length; index++) {
    if (code[index] === '?') offsets.push(index)
  }
  return offsets
}

/**
 * Rewrite each code-level `?` into the driver's own placeholder syntax, in order.
 *
 * Fails CLOSED on an arity mismatch rather than silently binding the wrong count: a
 * mismatch means the caller's slot list and this scan disagree about the SQL, which is
 * exactly the condition that used to ship a corrupted query.
 */
export function rewriteQuestionPlaceholders(
  sql: string,
  paramCount: number,
  grammar: SqlLiteralGrammar,
  render: (index: number) => string,
): string {
  const offsets = findQuestionPlaceholders(sql, grammar)
  if (offsets.length > paramCount) {
    throw new Error(`Query has more placeholders than values (${offsets.length} vs ${paramCount}).`)
  }
  if (offsets.length < paramCount) {
    throw new Error(`Query has more values than placeholders (${paramCount} vs ${offsets.length}).`)
  }
  let out = ''
  let cursor = 0
  offsets.forEach((offset, index) => {
    out += sql.slice(cursor, offset) + render(index)
    cursor = offset + 1
  })
  return out + sql.slice(cursor)
}
