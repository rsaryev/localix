/**
 * Live SQL diagnostics: a table that does not exist, a column that is not on its table, an
 * alias nothing defines — shown while the query is typed, not after it fails.
 *
 * The rule the whole module follows: a name is only called unknown when EVERYTHING that could
 * define it is known. A false squiggle on a query that runs costs more than a missed one — it
 * teaches the user to stop reading the squiggles — so each check has its own precondition:
 *
 *  - a relation is judged once the schema tree has loaded (`catalog` non-null), and only in a
 *    schema the tree lists (`other_db.t` is not ours to judge);
 *  - `alias.col` is judged once THAT table's columns have loaded;
 *  - a bare `col` is judged only when every relation in the statement is a known, loaded table
 *    and nothing correlated (a subquery, a CTE, a derived table) could supply it — and only in
 *    an operand position, never an arbitrary word, since dialects add keywords no list has.
 *
 * Bare columns are warnings, the other two errors: the first two are certain once their inputs
 * have loaded, the third is certain only as far as the operand-position reading is.
 */
import type { DbDialect } from '../../../shared/driver-catalog'
import { KEYWORDS } from '../format-sql/vocab'
import type { SqlCatalog, SqlCatalogTable } from './catalog'
import { analyzeStatement, ANALYZED_VERBS, splitStatements, type SqlStatementScope } from './scope'
import { closestName } from './suggest'
import { isIdent, isWord, tokenizeSql, type SqlToken } from './tokens'

export type SqlDiagnosticCode = 'unknown-table' | 'unknown-column' | 'unknown-alias'

export interface SqlDiagnostic {
  start: number
  end: number
  severity: 'error' | 'warning'
  code: SqlDiagnosticCode
  message: string
}

export interface SqlDiagnosticsResult {
  diagnostics: SqlDiagnostic[]
  /** Tables whose columns a check needed and did not have — load them, then re-run. */
  wantColumns: Array<{ name: string; schema: string }>
}

/** Words that stand where a column can (`= TRUE`, `> CURRENT_DATE`) and are values instead. */
const VALUE_WORDS = new Set(
  (
    'TRUE FALSE NULL UNKNOWN DEFAULT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP LOCALTIME ' +
    'LOCALTIMESTAMP CURRENT_USER SESSION_USER CURRENT_SCHEMA CURRENT_CATALOG USER SYSDATE ' +
    'ROWNUM ROWID _ROWID_ OID CTID XMIN XMAX CMIN CMAX TABLEOID ANY SOME ALL INTERVAL'
  ).split(' '),
)

/** Qualifiers a statement may use without declaring them (upserts, OUTPUT, triggers). */
const PSEUDO_QUALIFIERS = new Set(['excluded', 'new', 'old', 'inserted', 'deleted'])

/** Calls whose arguments include bare unit/keyword words (`EXTRACT(year FROM …)`). */
const KEYWORD_ARG_CALLS = new Set(
  (
    'EXTRACT DATE_PART DATE_TRUNC DATEADD DATEDIFF DATEPART DATENAME DATE_ADD DATE_SUB ' +
    'TIMESTAMPADD TIMESTAMPDIFF TRIM SUBSTRING POSITION OVERLAY CONVERT CAST TRY_CAST'
  ).split(' '),
)

const COMPARISON = new Set(['=', '<', '>', '<=', '>=', '<>', '!=', '+', '-', '*', '/', '%', '||'])
const BEFORE_OPERAND = new Set(
  'SELECT DISTINCT BY WHERE AND OR NOT ON HAVING SET WHEN THEN ELSE'.split(' '),
)
const AFTER_OPERAND = new Set(
  (
    'FROM WHERE AND OR AS ASC DESC NULLS IS IN NOT LIKE ILIKE BETWEEN THEN ELSE END WHEN GROUP ' +
    'ORDER HAVING LIMIT OFFSET UNION INTERSECT EXCEPT'
  ).split(' '),
)

function quote(name: string): string {
  return `"${name}"`
}

function didYouMean(name: string, candidates: readonly string[]): string {
  const hit = closestName(name, candidates)
  return hit ? ` Did you mean ${quote(hit)}?` : ''
}

/** Is token `i` in an operand position, where only a column, a value or a literal can stand? */
function inOperandPosition(tokens: SqlToken[], i: number): boolean {
  const prev = tokens[i - 1]
  const next = tokens[i + 1]
  const prevOk =
    prev === undefined ||
    (prev.kind === 'punct' &&
      (prev.text === ',' || prev.text === '(' || COMPARISON.has(prev.text))) ||
    (prev.kind === 'word' && BEFORE_OPERAND.has(prev.text.toUpperCase()))
  const nextOk =
    next === undefined ||
    (next.kind === 'punct' &&
      (next.text === ',' || next.text === ')' || COMPARISON.has(next.text))) ||
    (next.kind === 'word' && AFTER_OPERAND.has(next.text.toUpperCase()))
  return prevOk && nextOk
}

/** For each token, the name of the call whose parens it sits in (`EXTRACT`), if any. */
function enclosingCalls(tokens: SqlToken[]): Array<string | undefined> {
  const stack: Array<string | undefined> = []
  return tokens.map((token, i) => {
    if (token.text === ')') stack.pop()
    const inside = stack.at(-1)
    if (token.text === '(') {
      const callee = tokens[i - 1]
      stack.push(callee?.kind === 'word' ? callee.text.toUpperCase() : undefined)
    }
    return inside
  })
}

function unionColumns(tables: SqlCatalogTable[]): { set: Set<string>; names: string[] } | null {
  const set = new Set<string>()
  const names: string[] = []
  for (const table of tables) {
    if (!table.columns) return null
    for (const column of table.columns) set.add(column)
    names.push(...table.columnNames)
  }
  return { set, names }
}

/**
 * Names the buffer itself creates — `CREATE [TEMP] TABLE|VIEW x`, `SELECT … INTO x`, `ALTER …
 * RENAME TO x`. A script that creates a table and then reads it is correct before the schema
 * tree has reloaded, so those names are in scope (with no columns to judge) wherever they appear.
 */
function createdNames(statements: SqlToken[][]): Set<string> {
  const created = new Set<string>()
  const nameAfter = (tokens: SqlToken[], at: number) => {
    let i = at
    if (isWord(tokens[i], 'IF')) i += isWord(tokens[i + 1], 'NOT') ? 3 : 2
    let name: SqlToken | undefined
    while (isIdent(tokens[i])) {
      name = tokens[i]
      if (tokens[i + 1]?.text !== '.') break
      i += 2
    }
    if (name) created.add(name.name.toLowerCase())
  }
  for (const tokens of statements) {
    tokens.forEach((token, i) => {
      const creates =
        (isWord(token, 'TABLE', 'VIEW') && tokens.slice(0, i).some((t) => isWord(t, 'CREATE'))) ||
        (isWord(token, 'INTO') && isWord(tokens[0], 'SELECT')) ||
        (isWord(token, 'TO') && isWord(tokens[i - 1], 'RENAME'))
      if (creates) nameAfter(tokens, i + 1)
    })
  }
  return created
}

function diagnoseStatement(
  scope: SqlStatementScope,
  catalog: SqlCatalog,
  created: ReadonlySet<string>,
  out: SqlDiagnosticsResult,
): void {
  const { tokens } = scope
  const resolved = scope.relations.map((relation) => ({
    relation,
    tables:
      relation.opaque || created.has(relation.parts.at(-1)!.toLowerCase())
        ? null
        : catalog.resolve(relation.parts),
  }))

  // 1. Relations.
  const relationTokens = new Set<number>()
  for (const { relation, tables } of resolved) {
    for (let k = 0; k < relation.tokenCount; k++) relationTokens.add(relation.tokenIndex + k)
    if (tables?.length === 0) {
      const name = relation.parts.at(-1)!
      out.diagnostics.push({
        start: relation.start,
        end: relation.end,
        severity: 'error',
        code: 'unknown-table',
        message: `Table ${quote(relation.parts.join('.'))} does not exist.${didYouMean(name, catalog.tableNames())}`,
      })
    }
    for (const table of tables ?? []) {
      if (!table.columns) out.wantColumns.push({ name: table.name, schema: table.schema })
    }
  }

  // Qualifier → the relation it names: its alias, or its bare name.
  const qualifiers = new Map<string, (typeof resolved)[number]>()
  for (const entry of resolved) {
    const { relation } = entry
    if (relation.alias) qualifiers.set(relation.alias.toLowerCase(), entry)
    qualifiers.set(relation.parts.at(-1)!.toLowerCase(), entry)
  }
  const complete = resolved.every(({ tables }) => tables !== null && tables.length > 0)
  const scopeColumns = complete
    ? unionColumns(resolved.flatMap(({ tables }) => tables ?? []))
    : null
  const bareDecidable =
    scopeColumns !== null && !scope.hasSubquery && scope.ctes.size === 0 && resolved.length > 0
  const calls = enclosingCalls(tokens)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (relationTokens.has(i) || !isIdent(token)) continue
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    if (prev?.text === '.' || prev?.text === '::' || next?.text === '(') continue

    // 2. `qualifier.column` — exactly two parts, not a call.
    if (next?.text === '.' && isIdent(tokens[i + 2])) {
      const after = tokens[i + 3]
      if (after?.text === '.' || after?.text === '(') continue
      const column = tokens[i + 2]!
      i += 2
      const qualifier = token.name.toLowerCase()
      const entry = qualifiers.get(qualifier)
      if (!entry) {
        if (
          complete &&
          !scope.hasSubquery &&
          !PSEUDO_QUALIFIERS.has(qualifier) &&
          !scope.ctes.has(qualifier)
        ) {
          out.diagnostics.push({
            start: token.start,
            end: token.end,
            severity: 'warning',
            code: 'unknown-alias',
            message: `${quote(token.name)} is not a table or alias in this statement.`,
          })
        }
        continue
      }
      const columns = entry.tables?.length ? unionColumns(entry.tables) : null
      if (!columns || columns.set.has(column.name.toLowerCase())) continue
      out.diagnostics.push({
        start: column.start,
        end: column.end,
        severity: 'error',
        code: 'unknown-column',
        message: `Column ${quote(column.name)} does not exist in ${quote(entry.relation.parts.join('.'))}.${didYouMean(column.name, columns.names)}`,
      })
      continue
    }

    // 3. A bare column, only where it cannot be anything else.
    if (!bareDecidable || next?.text === '.' || next?.kind === 'string') continue
    const upper = token.kind === 'word' ? token.name.toUpperCase() : ''
    if (upper && (KEYWORDS.has(upper) || VALUE_WORDS.has(upper))) continue
    const lower = token.name.toLowerCase()
    if (scope.outputAliases.has(lower) || qualifiers.has(lower)) continue
    if (KEYWORD_ARG_CALLS.has(calls[i] ?? '')) continue
    if (!inOperandPosition(tokens, i) || scopeColumns!.set.has(lower)) continue
    const where = resolved.map(({ relation }) => quote(relation.parts.join('.'))).join(', ')
    out.diagnostics.push({
      start: token.start,
      end: token.end,
      severity: 'warning',
      code: 'unknown-column',
      message: `Column ${quote(token.name)} does not exist in ${where}.${didYouMean(token.name, scopeColumns!.names)}`,
    })
  }
}

export function diagnoseSql(
  sql: string,
  dialect: DbDialect,
  catalog: SqlCatalog | null,
): SqlDiagnosticsResult {
  const out: SqlDiagnosticsResult = { diagnostics: [], wantColumns: [] }
  if (!catalog) return out
  const statements = splitStatements(tokenizeSql(sql, dialect))
  const created = createdNames(statements)
  for (const statement of statements) {
    const scope = analyzeStatement(statement)
    if (ANALYZED_VERBS.has(scope.verb) && !isWord(statement[0], 'CREATE')) {
      diagnoseStatement(scope, catalog, created, out)
    }
  }
  return out
}
