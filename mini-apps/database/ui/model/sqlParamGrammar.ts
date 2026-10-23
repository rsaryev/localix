import type { DatabaseQueryParameterSyntax, DbDialect } from '../../shared/driver-catalog'
import { maskSqlNonCode, sqlGrammarForDialect } from '../../shared/sql-regions'

export const IDENT_START = /[a-zA-Z_]/
export const IDENT_CHAR = /[a-zA-Z0-9_]/

export function hasSyntax(
  syntaxes: ReadonlySet<DatabaseQueryParameterSyntax>,
  syntax: DatabaseQueryParameterSyntax,
): boolean {
  return syntaxes.has(syntax)
}

/** Replace non-code SQL regions with spaces while preserving offsets/newlines. */
export function maskSqlBodies(sql: string, dialect: DbDialect): string {
  return maskSqlNonCode(sql, sqlGrammarForDialect(dialect))
}

/** T-SQL variables declared inside the statement are local variables, not bind inputs. */
export function declaredAtNames(sql: string, dialect: DbDialect): Set<string> {
  const names = new Set<string>()
  const code = maskSqlBodies(sql, dialect)
  const lines = code.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const match = /\bDECLARE\b(.*)$/i.exec(lines[lineIndex])
    if (!match) continue
    let declaration = match[1] ?? ''
    while (
      (declaration.trim() === '' || declaration.trimEnd().endsWith(',')) &&
      lineIndex + 1 < lines.length
    ) {
      declaration += `\n${lines[++lineIndex]}`
    }
    for (const item of declaration.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      names.add(item[1].toLowerCase())
    }
  }
  for (const match of code.matchAll(/\bSET\s+@([a-zA-Z_][a-zA-Z0-9_]*)/gi))
    names.add(match[1].toLowerCase())
  return names
}

const PARAMETER_CONTEXT_WORDS = new Set([
  'ALL',
  'AND',
  'AS',
  'BETWEEN',
  'BY',
  'CASE',
  'DISTINCT',
  'ELSE',
  'FILTER',
  'HAVING',
  'ILIKE',
  'IN',
  'IS',
  'LIKE',
  'LIMIT',
  'NOT',
  'OFFSET',
  'ON',
  'OR',
  'RETURNING',
  'SELECT',
  'SET',
  'THEN',
  'VALUES',
  'WHEN',
  'WHERE',
])

/** PostgreSQL/hstore use bare `?` as an infix existence operator. A portable anonymous
 * placeholder appears where an expression starts; an operator follows an already-complete
 * expression. */
export function isPostgresInfixQuestion(sql: string, code: string, index: number): boolean {
  let previous = index - 1
  while (previous >= 0 && /\s/.test(code[previous])) previous--
  if (previous < 0) return false

  let rawPrevious = index - 1
  while (rawPrevious >= 0 && /\s/.test(sql[rawPrevious])) rawPrevious--
  if (`'"\\\`]`.includes(sql[rawPrevious] ?? '')) return true

  const char = code[previous]
  if (char === ')' || char === ']' || /\d/.test(char)) return true
  if (!IDENT_CHAR.test(char)) return false
  let start = previous
  while (start > 0 && IDENT_CHAR.test(code[start - 1])) start--
  return !PARAMETER_CONTEXT_WORDS.has(code.slice(start, previous + 1).toUpperCase())
}
