// Pure statement/context analyzers: where the cursor sits, what the statement
// references, and the alias/CTE vocabulary it defines. No completion items here.
import type { SqlSchemaModel } from './model'
import { defineRecordValue, ownRecordValue } from '../../../shared/safe-record'

export function stripQuotes(name: string): string {
  return name.replace(/^"|"$/g, '')
}

/**
 * Resolve a (possibly schema-qualified) table name to the key it has in the schema
 * model, which is keyed by bare table name. Tries the exact name first, then the last
 * dotted segment — so `public.users` and `dbo.Orders` still find their columns.
 */
export function resolveTableKey(model: SqlSchemaModel, name: string): string | undefined {
  if (ownRecordValue(model.columnsByTable, name)) return name
  const bare = name.includes('.') ? (name.split('.').pop() as string) : undefined
  return bare && ownRecordValue(model.columnsByTable, bare) ? bare : undefined
}

/** Map query aliases to their table, from FROM/JOIN clauses: `FROM t [AS] x`, `JOIN t x`. */
export function aliasMap(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /\b(?:from|join)\s+("?[\w.]+"?)(?:\s+as)?(?:\s+("?[\w]+"?))?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const table = stripQuotes(m[1])
    if (m[2]) {
      const alias = stripQuotes(m[2])
      // Don't treat a trailing keyword ("FROM t WHERE") as an alias.
      if (
        !/^(where|on|group|order|having|limit|inner|left|right|outer|join|as|using|set|values)$/i.test(
          alias,
        )
      ) {
        defineRecordValue(out, alias, table)
      }
    }
  }
  return out
}

/**
 * Output aliases declared with `AS <name>` in each `SELECT … FROM` window (the select
 * list), so they complete downstream — most usefully in GROUP BY / ORDER BY / HAVING.
 * Scans each window separately (handles UNION + subqueries); deduped. Heuristic.
 */
export function selectAliases(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const window = /\bselect\b([\s\S]*?)(?:\bfrom\b|$)/gi
  let w: RegExpExecArray | null
  while ((w = window.exec(text))) {
    const as = /\bas\s+("?[\w]+"?)/gi
    let m: RegExpExecArray | null
    while ((m = as.exec(w[1]))) {
      const name = stripQuotes(m[1])
      if (!seen.has(name)) {
        seen.add(name)
        out.push(name)
      }
    }
  }
  return out
}

/**
 * Names defined by a `WITH <name> AS ( … )` common-table expression in the current
 * document, so they complete as tables in FROM/JOIN even though they aren't in the
 * schema. Heuristic (`<ident> AS (`), deduped; harmless extra suggestions at worst.
 */
export function cteNames(text: string): string[] {
  const re = /\b("?[\w]+"?)\s+as\s*\(/gi
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = stripQuotes(m[1])
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** The identifier token currently being typed immediately before the cursor, if any. */
export function currentWord(before: string): string {
  const m = /([A-Za-z_]\w*)$/.exec(before)
  return m ? m[1] : ''
}

/** Match the casing of the word the user is typing: lowercase input → lowercase keyword. */
export function cased(before: string, kw: string): string {
  const w = currentWord(before)
  return w.length > 0 && w === w.toLowerCase() ? kw.toLowerCase() : kw
}

/**
 * True when the cursor sits at the start of a statement — only whitespace (or a single
 * partial word being typed) since the last `;`. There, only statement-leading keywords
 * make sense, not columns/tables.
 */
export function atStatementStart(before: string): boolean {
  const stmt = before.slice(before.lastIndexOf(';') + 1)
  return /^\s*([A-Za-z_]\w*)?$/.test(stmt)
}

/**
 * The single SQL statement the cursor sits in — text between the previous `;` and the next
 * one (or the document ends). Scopes the whole-statement analyzers (referenced tables, aliases,
 * CTEs, join snippets) so a multi-statement `.sql` file doesn't leak one query's tables/columns
 * into another's completions.
 */
export function currentStatement(text: string, offset: number): string {
  const start = text.lastIndexOf(';', offset - 1) + 1
  const next = text.indexOf(';', offset)
  return text.slice(start, next === -1 ? text.length : next)
}

/** The clause keyword governing the cursor — the last of these seen before it (scoped to the
 *  current statement by the caller). Two-word clauses are normalized to a single space. */
export function currentClause(stmtBefore: string): string {
  const re = /\b(where|having|on|order\s+by|group\s+by|set|select|from|join|values)\b/gi
  let last = ''
  let m: RegExpExecArray | null
  while ((m = re.exec(stmtBefore))) last = m[1].toLowerCase().replace(/\s+/g, ' ')
  return last
}

/**
 * Tables actually referenced by the statement's FROM/JOIN/UPDATE/INTO clauses, in
 * appearance order. Only known tables (present in the schema) are returned so callers
 * can scope column completions to the query the user is actually writing.
 */
export function referencedTables(text: string, model: SqlSchemaModel): string[] {
  const re = /\b(?:from|join|update|into)\s+("?[\w.]+"?)/gi
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const table = resolveTableKey(model, stripQuotes(m[1]))
    if (table && !seen.has(table)) {
      seen.add(table)
      out.push(table)
    }
  }
  return out
}
