/**
 * Safe, driver-owned query-parameter binding.
 *
 * A console recognizes only the placeholder spellings declared by its driver manifest,
 * then compiles every spelling to the adapter's one binding style. Values always travel
 * out-of-band in the `params` array; this module never interpolates user input into SQL.
 *
 * The scanner deliberately skips quoted strings, identifiers, comments, postgres casts
 * and dollar-quoted bodies so tokens shown in SQL text are not mistaken for parameters.
 */
import {
  getDatabaseDriverManifest,
  type DatabaseQueryParameterSyntax,
  type DbDialect,
} from '../../shared/driver-catalog'
import { maskSqlNonCode, sqlGrammarForDialect } from '../../shared/sql-regions'

export type ParamValueKey = `n:${string}` | `p:${number}`

/** Key values by semantic identity so repeated named/numbered placeholders share a value. */
export function paramKey(kind: 'named', id: string): `n:${string}`
export function paramKey(kind: 'positional', id: number): `p:${number}`
export function paramKey(kind: 'named' | 'positional', id: string | number): ParamValueKey {
  return kind === 'named' ? `n:${String(id)}` : `p:${Number(id)}`
}

export interface ParamSlot {
  kind: 'named' | 'positional'
  /** Name without its prefix for `:name`, `@name` and `$name`. */
  name?: string
  /** Zero-based logical position for `?`, `?1` and `$1`. */
  position?: number
  /** Canonical value identity shared by repeated placeholders. */
  key: ParamValueKey
  /** Source spelling shown to the user (`:email`, `$1`, `?2`, …). */
  label: string
  /** Offset of the placeholder in source SQL. */
  index: number
  /** Length of the source placeholder. */
  length: number
}

export interface ParamField {
  kind: ParamSlot['kind']
  key: ParamValueKey
  label: string
}

export interface ParamDescriptor {
  /** Unique values required by the statement, in first-use order. */
  fields: ParamField[]
  /** Whether the SQL uses any recognized parameters. */
  any: boolean
}

interface RawSlot {
  kind: ParamSlot['kind']
  name?: string
  position?: number
  anonymous?: boolean
  label: string
  index: number
  length: number
}

const IDENT_START = /[a-zA-Z_]/
const IDENT_CHAR = /[a-zA-Z0-9_]/

function hasSyntax(
  syntaxes: ReadonlySet<DatabaseQueryParameterSyntax>,
  syntax: DatabaseQueryParameterSyntax,
): boolean {
  return syntaxes.has(syntax)
}

/** Replace non-code SQL regions with spaces while preserving offsets/newlines. */
function maskSqlBodies(sql: string, dialect: DbDialect): string {
  return maskSqlNonCode(sql, sqlGrammarForDialect(dialect))
}

/** T-SQL variables declared inside the statement are local variables, not bind inputs. */
function declaredAtNames(sql: string, dialect: DbDialect): Set<string> {
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
function isPostgresInfixQuestion(sql: string, code: string, index: number): boolean {
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

function finishSlots(raw: RawSlot[]): ParamSlot[] {
  const reserved = new Set(
    raw.flatMap((slot) =>
      slot.kind === 'positional' && !slot.anonymous ? [slot.position as number] : [],
    ),
  )
  const anonymous = new Set<number>()
  let next = 0

  return raw.map((slot) => {
    if (slot.kind === 'named') {
      const name = slot.name as string
      return { ...slot, key: paramKey('named', name) }
    }
    let position = slot.position
    if (slot.anonymous) {
      while (reserved.has(next) || anonymous.has(next)) next++
      position = next
      anonymous.add(next)
      next++
    }
    const resolved = position as number
    return {
      kind: 'positional',
      position: resolved,
      key: paramKey('positional', resolved),
      label: slot.anonymous ? `?${resolved + 1}` : slot.label,
      index: slot.index,
      length: slot.length,
    }
  })
}

/** All recognized placeholders in source order for the selected driver. */
export function scanParams(sql: string, dialect: DbDialect): ParamSlot[] {
  const syntaxes = new Set(getDatabaseDriverManifest(dialect).queryParameters.syntaxes)
  if (syntaxes.size === 0) return []

  const declaredNames = hasSyntax(syntaxes, 'named-at')
    ? declaredAtNames(sql, dialect)
    : new Set<string>()
  const slots: RawSlot[] = []
  const code = maskSqlBodies(sql, dialect)
  const n = code.length
  let i = 0

  while (i < n) {
    const ch = code[i]
    // PostgreSQL `::type` cast and assignment-like `:=` are not named parameters.
    if (ch === ':' && (code[i + 1] === ':' || code[i + 1] === '=')) {
      i += 2
      continue
    }

    if (ch === ':' && hasSyntax(syntaxes, 'named-colon') && IDENT_START.test(code[i + 1] ?? '')) {
      let j = i + 2
      while (j < n && IDENT_CHAR.test(code[j])) j++
      const name = sql.slice(i + 1, j)
      slots.push({ kind: 'named', name, label: `:${name}`, index: i, length: j - i })
      i = j
      continue
    }

    if (ch === '@' && hasSyntax(syntaxes, 'named-at') && IDENT_START.test(code[i + 1] ?? '')) {
      let j = i + 2
      while (j < n && IDENT_CHAR.test(code[j])) j++
      const name = sql.slice(i + 1, j)
      if (!declaredNames.has(name.toLowerCase()))
        slots.push({ kind: 'named', name, label: `@${name}`, index: i, length: j - i })
      i = j
      continue
    }
    if (ch === '@' && code[i + 1] === '@') {
      // SQL Server global/system variables (`@@VERSION`, `@@ROWCOUNT`) are server-side
      // identifiers. Skip both sigils so the second one cannot become a named bind.
      i += 2
      continue
    }

    if (ch === '$') {
      if (hasSyntax(syntaxes, 'numbered-dollar') && /\d/.test(code[i + 1] ?? '')) {
        let j = i + 2
        while (j < n && /\d/.test(code[j])) j++
        const number = Number(sql.slice(i + 1, j))
        if (Number.isSafeInteger(number) && number > 0)
          slots.push({
            kind: 'positional',
            position: number - 1,
            label: sql.slice(i, j),
            index: i,
            length: j - i,
          })
        i = j
        continue
      }
      if (hasSyntax(syntaxes, 'named-dollar') && IDENT_START.test(code[i + 1] ?? '')) {
        let j = i + 2
        while (j < n && IDENT_CHAR.test(code[j])) j++
        const name = sql.slice(i + 1, j)
        slots.push({ kind: 'named', name, label: `$${name}`, index: i, length: j - i })
        i = j
        continue
      }
    }

    if (ch === '?') {
      // PostgreSQL JSON operators `?|`, `?&` and the common `??` operator are not binds.
      if (code[i + 1] === '|' || code[i + 1] === '&' || code[i + 1] === '?') {
        i += 2
        continue
      }
      if (hasSyntax(syntaxes, 'numbered-question') && /\d/.test(code[i + 1] ?? '')) {
        let j = i + 2
        while (j < n && /\d/.test(code[j])) j++
        const number = Number(sql.slice(i + 1, j))
        if (Number.isSafeInteger(number) && number > 0)
          slots.push({
            kind: 'positional',
            position: number - 1,
            label: sql.slice(i, j),
            index: i,
            length: j - i,
          })
        i = j
        continue
      }
      if (hasSyntax(syntaxes, 'question')) {
        if (dialect === 'postgres' && isPostgresInfixQuestion(sql, code, i)) {
          i++
          continue
        }
        slots.push({ kind: 'positional', anonymous: true, label: '?', index: i, length: 1 })
        i++
        continue
      }
    }
    i++
  }

  return finishSlots(slots)
}

/** Unique fields needed to execute a statement, in first-use order. */
export function describeParams(sql: string, dialect: DbDialect): ParamDescriptor {
  const fields: ParamField[] = []
  const seen = new Set<ParamValueKey>()
  for (const slot of scanParams(sql, dialect)) {
    if (seen.has(slot.key)) continue
    seen.add(slot.key)
    fields.push({ kind: slot.kind, key: slot.key, label: slot.label })
  }
  return { fields, any: fields.length > 0 }
}

/**
 * Interpret an input as a bind value: exact NULL → SQL NULL, an unambiguous number →
 * number when JavaScript can represent it exactly; wide integers/high-precision decimals
 * remain exact text for the database to coerce. Everything else (including empty) is text.
 */
export function typeParamValue(raw: string): unknown {
  const value = raw.trim()
  if (/^null$/i.test(value)) return null
  if (/^-?(0|[1-9]\d*)$/.test(value)) {
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : value
  }
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(value)) {
    const number = Number(value)
    const normalized = value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
    return Number.isFinite(number) && String(number) === normalized ? number : value
  }
  return raw
}

/**
 * Compile every accepted user placeholder to the adapter's binding style and collect
 * ordered values. Repeated named/numbered tokens reuse one input value but are emitted
 * once per occurrence because every backend adapter consumes a positional params array.
 */
export function compileSql(
  sql: string,
  dialect: DbDialect,
  values: Readonly<Record<ParamValueKey, unknown>>,
): { text: string; params: unknown[] } {
  const slots = scanParams(sql, dialect)
  const bindStyle = getDatabaseDriverManifest(dialect).queryParameters.bindStyle
  if (!bindStyle || slots.length === 0) return { text: sql, params: [] }

  const params: unknown[] = []
  let text = ''
  let last = 0
  for (const slot of slots) {
    text += sql.slice(last, slot.index)
    text += bindStyle === 'numbered-dollar' ? `$${params.length + 1}` : '?'
    params.push(values[slot.key])
    last = slot.index + slot.length
  }
  text += sql.slice(last)
  return { text, params }
}
