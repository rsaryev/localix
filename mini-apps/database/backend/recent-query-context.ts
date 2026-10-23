import type { EngineKind } from './drivers/port'
import { REDACTION_SQL_GRAMMAR, scanSqlRegions } from '../shared/sql-regions'

const MAX_QUERY_CHARS = 500
export const RECENT_QUERY_CONTEXT_LIMIT = 6
export const RECENT_QUERY_CONTEXT_MAX_CHARS = 1_200

/**
 * Preserve SQL structure and identifiers while removing literal values. Recent queries are
 * supporting context, so model quality needs joins/clauses—not data.
 *
 * Region scanning is a SINGLE left-to-right walk (shared/sql-regions), because the previous
 * chain of independent regex passes leaked verbatim values two different ways — both
 * reproduced with a planted token:
 *
 *   SELECT * FROM t WHERE note = 'it\'s SECRET'   →  '…'s SECRET'
 *     The literal pattern knew `''` but not `\'`, so the literal "ended" early and its tail
 *     was emitted as code. Affects MySQL and ClickHouse, where `\'` is an escape.
 *
 *   SELECT 'xSECRET--' , 'y'                      →  SELECT 'xSECRET
 *     The comment pass ran FIRST and cut from `--` to end of line, truncating the literal so
 *     the later literal pass no longer matched it. Affects every dialect.
 *
 * A single pass cannot have either bug: whichever region opens first wins, exactly as an
 * engine's lexer decides it.
 */
function sanitizeSqlForContext(sql: string): string {
  let out = ''
  let cursor = 0
  for (const region of scanSqlRegions(sql, REDACTION_SQL_GRAMMAR)) {
    out += sql.slice(cursor, region.start)
    // Backticks are identifiers in the SQL engines that accept them. Double quotes are
    // ambiguous: SQLite and default MySQL accept them as string literals (and T-SQL can
    // with QUOTED_IDENTIFIER OFF), so preserving their contents can leak a result value.
    // Privacy wins over retaining a quoted schema name in this supporting context.
    if (region.kind === 'identifier' && sql[region.start] !== '"')
      out += sql.slice(region.start, region.end)
    else if (region.kind === 'identifier') out += '"…"'
    else if (region.kind === 'string') out += "'…'"
    else if (region.kind === 'dollar-string') out += '$…$'
    else out += ' '
    cursor = region.end
  }
  return (out + sql.slice(cursor))
    .replace(/\b0x[0-9a-f]+\b/gi, '?')
    .replace(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_CHARS)
}

/**
 * Mongo/Elasticsearch consoles wrap JSON arguments in a method call. Keep object
 * keys/operators (the useful query shape), but redact every quoted scalar value;
 * numeric values are removed in a second pass. This is deliberately lexical so
 * even a malformed draft never falls back to returning raw values.
 */
function sanitizeDocumentQueryForContext(input: string): string {
  let output = ''
  for (let index = 0; index < input.length; index++) {
    const quote = input[index]
    if (quote !== '"' && quote !== "'") {
      output += quote
      continue
    }
    const start = index
    index++
    while (index < input.length) {
      const char = input[index]
      if (char === '\\') index++
      else if (char === quote) break
      index++
    }
    const token = input.slice(start, Math.min(input.length, index + 1))
    let next = index + 1
    while (/\s/.test(input[next] ?? '')) next++
    // A quoted token immediately followed by ':' is a JSON field/operator name.
    output += input[next] === ':' ? token : `${quote}…${quote}`
  }
  return output
    .replace(/\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_CHARS)
}

/** Redis keys and values are both runtime data. Retain only the command family and
 * argument arity; this is enough to show operational shape without leaking either. */
function sanitizeKvQueryForContext(input: string): string {
  const trimmed = input.trim()
  const command = /^[A-Za-z][A-Za-z0-9._-]*/.exec(trimmed)?.[0]?.toUpperCase()
  if (!command) return ''
  let args = 0
  let tokenOpen = false
  let quote: '"' | "'" | null = null
  for (let index = command.length; index < trimmed.length; index++) {
    const char = trimmed[index]!
    if (quote) {
      tokenOpen = true
      if (char === '\\') index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      tokenOpen = true
    } else if (/\s/.test(char)) {
      if (tokenOpen) {
        args++
        tokenOpen = false
      }
    } else {
      tokenOpen = true
    }
  }
  if (tokenOpen) args++
  return `${command}${args > 0 ? ` ${Array.from({ length: args }, () => '?').join(' ')}` : ''}`.slice(
    0,
    MAX_QUERY_CHARS,
  )
}

export function sanitizeQueryForContext(input: string, kind: EngineKind = 'sql'): string {
  return kind === 'sql'
    ? sanitizeSqlForContext(input)
    : kind === 'kv'
      ? sanitizeKvQueryForContext(input)
      : sanitizeDocumentQueryForContext(input)
}

/** Newest first, de-duplicated after sanitization and strictly bounded. */
export function recordRecentQuery(
  queries: readonly string[],
  input: string,
  kind: EngineKind = 'sql',
): string[] {
  const sanitized = sanitizeQueryForContext(input, kind)
  if (!sanitized) return [...queries]
  return [sanitized, ...queries.filter((query) => query !== sanitized)].slice(
    0,
    RECENT_QUERY_CONTEXT_LIMIT,
  )
}

export function renderRecentQueriesForContext(
  queries: readonly string[],
  maxChars = RECENT_QUERY_CONTEXT_MAX_CHARS,
): string {
  const output: string[] = []
  let used = 0
  for (const query of queries.slice(0, RECENT_QUERY_CONTEXT_LIMIT)) {
    const block = query.endsWith(';') ? query : `${query};`
    if (used + block.length > maxChars) break
    output.push(block)
    used += block.length
  }
  return output.join('\n')
}
