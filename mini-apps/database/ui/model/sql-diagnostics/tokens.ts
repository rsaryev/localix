/**
 * SQL tokens with source offsets, for the live diagnostics.
 *
 * The completion analyzers match regexes over raw text, so a `FROM users` inside a string
 * literal or a comment reads as a table reference. That is harmless for a suggestion list and
 * wrong for an error squiggle: a diagnostic that fires on a comment teaches the user to ignore
 * all of them. Strings, comments and quoted identifiers therefore come from the ONE dialect-aware
 * scanner (`shared/sql-regions.ts`) instead of a second hand-rolled one.
 */
import type { DbDialect } from '../../../shared/driver-catalog'
import { scanSqlRegions, sqlGrammarForDialect } from '../../../shared/sql-regions'

export type SqlTokenKind = 'word' | 'quoted' | 'string' | 'number' | 'param' | 'punct'

export interface SqlToken {
  kind: SqlTokenKind
  /** Raw source text. */
  text: string
  /** Identifier value: unquoted for `quoted`, as written for `word`, else the raw text. */
  name: string
  start: number
  end: number
}

const MULTI_CHAR_PUNCT = ['->>', '::', '<=', '>=', '<>', '!=', '||', '->']

function unquote(raw: string): string {
  const open = raw[0]
  const close = open === '[' ? ']' : open
  const inner = raw.slice(1, raw.endsWith(close!) ? -1 : undefined)
  return inner.replaceAll(close! + close!, close!)
}

export function tokenizeSql(sql: string, dialect: DbDialect): SqlToken[] {
  const regions = scanSqlRegions(sql, sqlGrammarForDialect(dialect))
  const tokens: SqlToken[] = []
  let region = 0
  let at = 0
  const push = (kind: SqlTokenKind, start: number, end: number, name?: string) => {
    const text = sql.slice(start, end)
    tokens.push({ kind, text, name: name ?? text, start, end })
  }
  while (at < sql.length) {
    const next = regions[region]
    if (next?.start === at) {
      region++
      if (next.kind === 'identifier') {
        push('quoted', next.start, next.end, unquote(sql.slice(next.start, next.end)))
      } else if (next.kind !== 'comment') {
        push('string', next.start, next.end)
      }
      at = next.end
      continue
    }
    const char = sql[at]!
    if (/\s/.test(char)) {
      at++
      continue
    }
    if (/[A-Za-z_\u0080-￿]/.test(char)) {
      let end = at + 1
      while (end < sql.length && /[\w$\u0080-￿]/.test(sql[end]!)) end++
      push('word', at, end)
      at = end
      continue
    }
    if (/\d/.test(char)) {
      let end = at + 1
      while (end < sql.length && /[\w.]/.test(sql[end]!)) end++
      push('number', at, end)
      at = end
      continue
    }
    // `:name`, `@var`, `$1`, `?` — a bind parameter or variable, never a column.
    if (/[:@$?]/.test(char) && sql[at + 1] !== ':') {
      let end = at + 1
      while (end < sql.length && /[\w$]/.test(sql[end]!)) end++
      if (end > at + 1 || char === '?') {
        push('param', at, end)
        at = end
        continue
      }
    }
    const multi = MULTI_CHAR_PUNCT.find((op) => sql.startsWith(op, at))
    const end = at + (multi?.length ?? 1)
    push('punct', at, end)
    at = end
  }
  return tokens
}

/** Is this token an identifier — bare or quoted? */
export function isIdent(token: SqlToken | undefined): token is SqlToken {
  return token?.kind === 'word' || token?.kind === 'quoted'
}

/** Case-insensitive keyword test on a BARE word (a quoted `"from"` is an identifier). */
export function isWord(token: SqlToken | undefined, ...words: string[]): boolean {
  if (token?.kind !== 'word') return false
  const upper = token.text.toUpperCase()
  return words.includes(upper)
}
