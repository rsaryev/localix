import type { DbDialect } from '../dbClient'
import { defineRecordValue } from '../../shared/safe-record'
import { singleStatementTokens, type Token } from './editableSelectTokens'

/**
 * Conservative query-result provenance for inline editing.
 *
 * The safety boundary: one SELECT, one physical table, direct result columns, and a
 * complete primary key in the result. WHERE / ORDER / LIMIT do not change row identity, while
 * joins, aggregates, CTEs, subqueries and set operations do. The second stage — resolving these
 * labels against live introspection — is `editableResult.ts`.
 */
export interface EditableSelect {
  table: string
  schema?: string
  /** SELECT * (or alias.*) lets result labels map to same-named physical columns. */
  wildcard: boolean
  /** Result label → physical source column for direct, optionally aliased columns. */
  columns: Record<string, string>
}

const CLAUSE_KEYWORDS = new Set(['where', 'order', 'limit', 'offset', 'fetch', 'for'])
const BLOCKED_KEYWORDS = new Set([
  'join',
  'group',
  'having',
  'distinct',
  'union',
  'intersect',
  'except',
  'with',
  'insert',
  'update',
  'delete',
  'merge',
])
const TABLE_ALIAS_STOP_KEYWORDS = new Set([
  ...CLAUSE_KEYWORDS,
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'outer',
  'on',
])
const IDENTIFIER_RE = /^[A-Za-z_@$#][A-Za-z0-9_@$#]*$/

function parseIdentifier(tokens: Token[], start: number) {
  const parts: string[] = []
  let index = start
  if (!tokens[index] || !IDENTIFIER_RE.test(tokens[index]!.text)) return null
  parts.push(tokens[index]!.text)
  index++
  while (tokens[index]?.text === '.') {
    index++
    if (!tokens[index] || !IDENTIFIER_RE.test(tokens[index]!.text)) return null
    parts.push(tokens[index]!.text)
    index++
  }
  return { parts, index }
}

function splitSelectItems(tokens: Token[]): Token[][] | null {
  const items: Token[][] = []
  let current: Token[] = []
  for (const token of tokens) {
    if (token.text === ',') {
      if (!current.length) return null
      items.push(current)
      current = []
    } else {
      current.push(token)
    }
  }
  if (!current.length) return null
  items.push(current)
  return items
}

function parseSelectItem(tokens: Token[], tableAlias?: string) {
  if (tokens.length === 1 && tokens[0]!.text === '*')
    return { wildcard: true, resultName: '', sourceName: '' }
  if (
    tokens.length === 3 &&
    tokens[1]!.text === '.' &&
    tokens[2]!.text === '*' &&
    (!tableAlias || tokens[0]!.lower === tableAlias.toLowerCase())
  )
    return { wildcard: true, resultName: '', sourceName: '' }

  const source = parseIdentifier(tokens, 0)
  if (!source || source.parts.length > 2) return null
  let index = source.index
  let alias: string | undefined
  if (tokens[index]?.lower === 'as') index++
  if (tokens[index]) {
    if (!IDENTIFIER_RE.test(tokens[index]!.text)) return null
    alias = tokens[index]!.text
    index++
  }
  if (index !== tokens.length) return null

  if (
    source.parts.length === 2 &&
    tableAlias &&
    source.parts[0]!.toLowerCase() !== tableAlias.toLowerCase()
  )
    return null
  const sourceName = source.parts.at(-1)!
  return { wildcard: false, resultName: alias ?? sourceName, sourceName }
}

/**
 * The dialect is required: whether `$$…$$`, `#` or a nested comment is code or data differs by
 * engine, and reading it wrongly is exactly how a set operation hid from this gate.
 */
export function analyzeEditableSelect(sql: string, dialect: DbDialect): EditableSelect | null {
  const tokens = singleStatementTokens(sql.trim(), dialect)
  if (tokens?.[0]?.lower !== 'select') return null
  if (
    tokens.some(
      (token, index) =>
        BLOCKED_KEYWORDS.has(token.lower) ||
        token.text === '(' ||
        token.text === ')' ||
        (token.lower === 'select' && index > 0),
    )
  )
    return null

  const fromIndex = tokens.findIndex((token) => token.lower === 'from')
  if (fromIndex <= 1) return null
  const parsedTable = parseIdentifier(tokens, fromIndex + 1)
  if (!parsedTable || parsedTable.parts.length < 1 || parsedTable.parts.length > 2) return null

  let index = parsedTable.index
  let tableAlias: string | undefined
  if (tokens[index] && !CLAUSE_KEYWORDS.has(tokens[index]!.lower)) {
    if (tokens[index]!.lower === 'as') index++
    const alias = tokens[index]
    if (!alias || !IDENTIFIER_RE.test(alias.text) || TABLE_ALIAS_STOP_KEYWORDS.has(alias.lower))
      return null
    tableAlias = alias.text
    index++
  }
  if (tokens[index] && !CLAUSE_KEYWORDS.has(tokens[index]!.lower)) return null

  const items = splitSelectItems(tokens.slice(1, fromIndex))
  if (!items) return null
  let wildcard = false
  const columns: Record<string, string> = {}
  for (const item of items) {
    const parsed = parseSelectItem(item, tableAlias ?? parsedTable.parts.at(-1))
    if (!parsed) return null
    if (parsed.wildcard) wildcard = true
    else {
      const key = parsed.resultName.toLowerCase()
      if (Object.keys(columns).some((name) => name.toLowerCase() === key)) return null
      defineRecordValue(columns, parsed.resultName, parsed.sourceName)
    }
  }

  const [schema, table] =
    parsedTable.parts.length === 2
      ? [parsedTable.parts[0], parsedTable.parts[1]]
      : [undefined, parsedTable.parts[0]]
  return { table: table!, schema, wildcard, columns }
}
