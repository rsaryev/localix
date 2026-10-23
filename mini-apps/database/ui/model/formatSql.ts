// Conservative, dialect-agnostic SQL pretty-printer for the "Format" action. It tokenizes
// while respecting string literals and comments (their contents are never rewritten),
// uppercases recognized keywords, normalizes inter-token whitespace, and breaks each major
// clause onto its own line. CREATE TABLE bodies get one definition per indented line so an
// engine's compact, single-line createScript remains readable in the DDL viewer. Output only
// ever differs in whitespace + keyword case, so it stays valid SQL. Not a full parser — good
// enough for everyday editing and schema inspection.
//
// Facade: the tokenizer + keyword vocabulary live in ./format-sql/*; this file owns the
// line-break + spacing rules.
import { isKeyword, tokenize, type Token } from './format-sql/tokenize'
import { CLAUSE_BREAK, FUNCTION_WORDS, JOIN_WORDS } from './format-sql/vocab'

interface DdlBody {
  open: number
  close: number
}

/** Find CREATE TABLE column/constraint lists without mistaking CREATE TABLE … AS SELECT. */
function findDdlBodies(tokens: Token[]): DdlBody[] {
  const bodies: DdlBody[] = []

  for (let idx = 0; idx < tokens.length; idx++) {
    if (tokens[idx]?.kind !== 'word' || tokens[idx]?.text.toUpperCase() !== 'CREATE') continue

    let table = -1
    for (let scan = idx + 1; scan < tokens.length && tokens[scan]?.text !== ';'; scan++) {
      const upper = tokens[scan]?.kind === 'word' ? tokens[scan].text.toUpperCase() : ''
      if (upper === 'TABLE') {
        table = scan
        break
      }
      // It is another CREATE form (VIEW/INDEX/TRIGGER), not a table declaration.
      if (upper === 'VIEW' || upper === 'INDEX' || upper === 'TRIGGER') break
    }
    if (table < 0) continue

    let open = -1
    for (let scan = table + 1; scan < tokens.length && tokens[scan]?.text !== ';'; scan++) {
      const upper = tokens[scan]?.kind === 'word' ? tokens[scan].text.toUpperCase() : ''
      if (upper === 'AS') break
      if (tokens[scan]?.text === '(') {
        open = scan
        break
      }
    }
    if (open < 0) continue

    let depth = 0
    for (let scan = open; scan < tokens.length; scan++) {
      if (tokens[scan]?.text === '(') depth++
      if (tokens[scan]?.text === ')') {
        depth--
        if (depth === 0) {
          bodies.push({ open, close: scan })
          idx = scan
          break
        }
      }
    }
  }

  return bodies
}

export function formatSql(sql: string): string {
  const tokens = tokenize(sql)
  const ddlBodies = findDdlBodies(tokens)
  const ddlOpens = new Set(ddlBodies.map((body) => body.open))
  const ddlCloses = new Set(ddlBodies.map((body) => body.close))
  const ddlCommas = new Set<number>()
  for (const body of ddlBodies) {
    let depth = 0
    for (let idx = body.open; idx <= body.close; idx++) {
      if (tokens[idx]?.text === '(') depth++
      if (tokens[idx]?.text === ',' && depth === 1) ddlCommas.add(idx)
      if (tokens[idx]?.text === ')') depth--
    }
  }
  const indentFor = (idx: number) =>
    ddlBodies.some((body) => idx > body.open && idx < body.close) ? '  ' : ''

  let out = ''
  let prev: Token | null = null
  let prevIdx = -1

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]
    const text = isKeyword(t) ? t.text.toUpperCase() : t.text
    const upper = t.kind === 'word' ? t.text.toUpperCase() : ''

    if (prev === null) {
      out += text
      prev = t
      prevIdx = idx
      continue
    }

    // A CREATE TABLE body is a compact structural list: each column or table constraint
    // starts on an indented line, while commas inside types/functions stay inline.
    if (ddlCloses.has(idx)) {
      out = `${out.trimEnd()}\n${text}`
      prev = t
      prevIdx = idx
      continue
    }
    if (ddlOpens.has(prevIdx) || ddlCommas.has(prevIdx)) {
      out += `\n  ${text}`
      prev = t
      prevIdx = idx
      continue
    }

    // A line comment runs to end-of-line, so anything after it MUST start a new line
    // (else the next token would be swallowed into the comment).
    if (prev.kind === 'comment' && prev.text.startsWith('--')) {
      out += `\n${indentFor(idx)}${text}`
      prev = t
      prevIdx = idx
      continue
    }

    // Each statement starts on its own line, separated by a blank line for readability.
    if (prev.text === ';') {
      out += (t.kind === 'comment' && prev.text.startsWith('--') ? '\n' : '\n\n') + text
      prev = t
      prevIdx = idx
      continue
    }

    // Break a major clause onto its own line (but never right after `(` — a subquery
    // opener — nor for `GROUP`/`ORDER` unless the next word is BY, to avoid false hits).
    const nextUpper = tokens[idx + 1]?.kind === 'word' ? tokens[idx + 1].text.toUpperCase() : ''
    const prevUpper = prev.kind === 'word' ? prev.text.toUpperCase() : ''
    // A join run (`LEFT OUTER JOIN`) breaks once — before the first join word of the run.
    const joinBreak = JOIN_WORDS.has(upper) && !JOIN_WORDS.has(prevUpper)
    const clauseBreak =
      prev.text !== '(' &&
      (joinBreak ||
        (CLAUSE_BREAK.has(upper) &&
          ((upper !== 'GROUP' && upper !== 'ORDER') || nextUpper === 'BY')))
    if (clauseBreak) {
      out += `\n${indentFor(idx)}${text}`
      prev = t
      prevIdx = idx
      continue
    }

    // Spacing between the previous token and this one.
    let space = true
    if (t.text === ',' || t.text === ';' || t.text === ')') space = false
    else if (prev.text === '(') space = false
    // A CREATE TABLE declaration list is not a function call: `table_name (` reads as
    // structure and avoids gluing the object name to its first column.
    else if (ddlOpens.has(idx)) space = true
    // `(` glues to a function-like word (`COUNT(*)`, a user function) but NOT to a
    // clause keyword — `VALUES (…)`, `IN (…)`, `ON (…)` keep the space.
    else if (
      t.text === '(' &&
      prev.kind === 'word' &&
      (!isKeyword(prev) || FUNCTION_WORDS.has(prevUpper))
    )
      space = false
    else if (prev.text === '.' || t.text === '.') space = false
    else if (prev.kind === 'word' && prev.text.endsWith('.')) space = false // `t.` + `*`
    // Accessor/cast operators bind tight on both sides: id::text, data->'k', data->>'k'.
    else if (
      prev.text === '::' ||
      t.text === '::' ||
      prev.text === '->' ||
      t.text === '->' ||
      prev.text === '->>' ||
      t.text === '->>'
    )
      space = false
    // A string-literal prefix must stay glued to its quote: E'…' N'…' X'ff' B'101'.
    else if (t.kind === 'string' && prev.kind === 'word' && /^[enbx]$/i.test(prev.text))
      space = false
    out += (space ? ' ' : '') + text
    prev = t
    prevIdx = idx
  }
  return out.trim()
}
