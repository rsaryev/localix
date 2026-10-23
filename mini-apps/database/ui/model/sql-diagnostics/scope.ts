/**
 * What one SQL statement brings into scope: the relations it reads or writes, their aliases,
 * the CTE names it defines and the output aliases of its select list.
 *
 * The diagnostics may only call a name unknown when they know EVERYTHING that could define it,
 * so this answers two questions at once — "what is in scope" and "is that picture complete".
 * A statement whose scope is not fully understood (a derived table, a correlated subquery, a
 * DDL statement) is marked so, and the column checks that need the complete picture stand down
 * rather than guess.
 */
import { KEYWORDS } from '../format-sql/vocab'
import { isIdent, isWord, type SqlToken } from './tokens'

export interface SqlRelation {
  /** Name parts as written: `["public", "users"]`. */
  parts: string[]
  start: number
  end: number
  /** A CTE or derived table — in scope, but with no catalog entry to check against. */
  opaque: boolean
  alias?: string
  /** Token index of the relation's first part, so column checks can skip its own tokens. */
  tokenIndex: number
  tokenCount: number
}

export interface SqlStatementScope {
  tokens: SqlToken[]
  /** Upper-cased leading keyword (after an EXPLAIN prefix). */
  verb: string
  relations: SqlRelation[]
  ctes: Set<string>
  /** Lower-cased output aliases (`AS x` anywhere, implicit select-list aliases). */
  outputAliases: Set<string>
  /** Token index → paren frame kind the token sits in (`top` outside any paren). */
  frames: FrameKind[]
  /** Any `( SELECT … )` — its correlation makes unqualified names undecidable. */
  hasSubquery: boolean
}

export type FrameKind = 'top' | 'subquery' | 'group'

/** Verbs whose names the diagnostics understand. DDL creates the names it mentions. */
export const ANALYZED_VERBS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'])

/** Words that end a relation reference instead of aliasing it (`FROM t WHERE …`). */
const NOT_AN_ALIAS = new Set(
  (
    'WHERE ON USING JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL GROUP ORDER HAVING LIMIT ' +
    'OFFSET UNION INTERSECT EXCEPT SET VALUES WINDOW RETURNING FETCH FOR LATERAL AS WITH ' +
    'SELECT DEFAULT OUTPUT TABLESAMPLE FINAL PREWHERE SAMPLE ARRAY QUALIFY INTO USE FORCE IGNORE'
  ).split(' '),
)

/** Split on top-level `;`, returning token slices. */
export function splitStatements(tokens: SqlToken[]): SqlToken[][] {
  const out: SqlToken[][] = []
  let current: SqlToken[] = []
  for (const token of tokens) {
    if (token.kind === 'punct' && token.text === ';') {
      if (current.length) out.push(current)
      current = []
    } else current.push(token)
  }
  if (current.length) out.push(current)
  return out
}

function frameKinds(tokens: SqlToken[]): { frames: FrameKind[]; hasSubquery: boolean } {
  const stack: FrameKind[] = ['top']
  const frames: FrameKind[] = []
  let hasSubquery = false
  tokens.forEach((token, index) => {
    // An unbalanced `)` (a half-typed query) must not pop the statement's own frame.
    if (token.kind === 'punct' && token.text === ')' && stack.length > 1) stack.pop()
    frames.push(stack.at(-1)!)
    if (token.kind === 'punct' && token.text === '(') {
      const subquery = isWord(tokens[index + 1], 'SELECT', 'WITH', 'VALUES')
      hasSubquery ||= subquery
      stack.push(subquery ? 'subquery' : 'group')
    }
  })
  return { frames, hasSubquery }
}

function readCtes(tokens: SqlToken[]): Set<string> {
  const ctes = new Set<string>()
  if (!isWord(tokens[0], 'WITH')) return ctes
  // `WITH [RECURSIVE] a [(cols)] AS (…), b AS (…)` — a name is an identifier followed, perhaps
  // after a column list, by `AS (`.
  for (let i = 1; i < tokens.length; i++) {
    if (!isIdent(tokens[i]) || isWord(tokens[i], 'RECURSIVE', 'AS')) continue
    let j = i + 1
    if (tokens[j]?.text === '(') {
      let depth = 0
      for (; j < tokens.length; j++) {
        if (tokens[j]!.text === '(') depth++
        if (tokens[j]!.text === ')' && --depth === 0) break
      }
      j++
    }
    if (
      isWord(tokens[j], 'AS') &&
      (tokens[j + 1]?.text === '(' || isWord(tokens[j + 1], 'NOT', 'MATERIALIZED'))
    ) {
      ctes.add(tokens[i]!.name.toLowerCase())
    }
  }
  return ctes
}

/** Parse one relation reference starting at `i`; returns it and the index after it. */
function readRelation(
  tokens: SqlToken[],
  i: number,
  ctes: Set<string>,
): { relation?: SqlRelation; next: number } {
  while (isWord(tokens[i], 'ONLY', 'LATERAL')) i++
  const first = tokens[i]
  if (first?.text === '(') {
    // A derived table: skip to its close and keep the alias as an opaque relation.
    let depth = 0
    let j = i
    for (; j < tokens.length; j++) {
      if (tokens[j]!.text === '(') depth++
      if (tokens[j]!.text === ')' && --depth === 0) break
    }
    j++
    if (isWord(tokens[j], 'AS')) j++
    const alias = isIdent(tokens[j]) && !isWord(tokens[j], ...NOT_AN_ALIAS) ? tokens[j] : undefined
    if (!alias) return { next: j }
    const relation: SqlRelation = {
      parts: [alias.name],
      start: alias.start,
      end: alias.end,
      opaque: true,
      alias: alias.name,
      tokenIndex: j,
      tokenCount: 1,
    }
    return { relation, next: j + 1 }
  }
  // A bare keyword is never a relation name — quoting is how SQL spells a table called `set`.
  if (!isIdent(first) || (first.kind === 'word' && KEYWORDS.has(first.text.toUpperCase()))) {
    return { next: i }
  }
  const parts = [first.name]
  let j = i + 1
  while (tokens[j]?.text === '.' && isIdent(tokens[j + 1])) {
    parts.push(tokens[j + 1]!.name)
    j += 2
  }
  // `FROM generate_series(…)`, `FROM read_csv(…)` — a table function, not a relation.
  if (tokens[j]?.text === '(' && !isWord(tokens[i - 1], 'INTO')) return { next: j }
  const relation: SqlRelation = {
    parts,
    start: first.start,
    end: tokens[j - 1]!.end,
    opaque: parts.length === 1 && ctes.has(parts[0]!.toLowerCase()),
    tokenIndex: i,
    tokenCount: j - i,
  }
  if (isWord(tokens[j], 'AS')) j++
  const alias = tokens[j]
  if (isIdent(alias) && !isWord(alias, ...NOT_AN_ALIAS)) {
    relation.alias = alias.name
    j++
  }
  return { relation, next: j }
}

function readRelations(tokens: SqlToken[], frames: FrameKind[], verb: string, ctes: Set<string>) {
  const relations: SqlRelation[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    // `EXTRACT(x FROM y)`, `TRIM(… FROM …)` sit in a call's parens; only a query frame reads.
    if (frames[i] === 'group') continue
    const opens = isWord(token, 'FROM', 'JOIN', 'UPDATE', 'INTO')
    if (!opens) continue
    if (isWord(token, 'FROM') && isWord(tokens[i - 1], 'DISTINCT')) continue
    // `SELECT … INTO new_table` creates it (T-SQL); only INSERT/REPLACE/MERGE INTO reads one.
    if (isWord(token, 'INTO') && verb === 'SELECT') continue
    // `ON CONFLICT … DO UPDATE SET`, `ON DUPLICATE KEY UPDATE` update the row in hand.
    if (isWord(token, 'UPDATE') && isWord(tokens[i - 1], 'DO', 'KEY')) continue
    let at = i + 1
    for (;;) {
      const { relation, next } = readRelation(tokens, at, ctes)
      if (relation) relations.push(relation)
      at = next
      if (!isWord(token, 'FROM') || tokens[at]?.text !== ',') break
      at++
    }
    i = at - 1
  }
  return relations
}

/** `AS x` anywhere, plus implicit select-list aliases (`count(*) total`, `a.b label`). */
function readOutputAliases(tokens: SqlToken[], frames: FrameKind[]): Set<string> {
  const aliases = new Set<string>()
  tokens.forEach((token, i) => {
    if (isWord(token, 'AS') && isIdent(tokens[i + 1]))
      aliases.add(tokens[i + 1]!.name.toLowerCase())
    const next = tokens[i + 1]
    const itemEnds = next?.text === ',' || isWord(next, 'FROM') || next === undefined
    const prev = tokens[i - 1]
    // An alias follows an EXPRESSION; after a keyword (`AND deleted`) the word is an operand,
    // and treating it as an alias would hide exactly the typo the check exists for.
    const follows =
      prev !== undefined &&
      (prev.text === ')' ||
        prev.kind === 'quoted' ||
        prev.kind === 'number' ||
        prev.kind === 'string' ||
        (prev.kind === 'word' && !KEYWORDS.has(prev.text.toUpperCase())))
    if (frames[i] === 'top' && isIdent(token) && itemEnds && follows) {
      aliases.add(token.name.toLowerCase())
    }
  })
  return aliases
}

export function analyzeStatement(tokens: SqlToken[]): SqlStatementScope {
  const lead = isWord(tokens[0], 'EXPLAIN')
    ? tokens.findIndex((t) => isWord(t, ...ANALYZED_VERBS))
    : 0
  const body = lead > 0 ? tokens.slice(lead) : tokens
  const verb = body[0]?.kind === 'word' ? body[0].text.toUpperCase() : ''
  const { frames, hasSubquery } = frameKinds(body)
  const ctes = readCtes(body)
  return {
    tokens: body,
    verb,
    relations: ANALYZED_VERBS.has(verb) ? readRelations(body, frames, verb, ctes) : [],
    ctes,
    outputAliases: readOutputAliases(body, frames),
    frames,
    hasSubquery,
  }
}
