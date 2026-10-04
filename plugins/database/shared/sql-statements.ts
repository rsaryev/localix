/**
 * ONE top-level SQL statement splitter, shared by the console editor (caret statement, "Run
 * all") and the backend (a multi-statement text is executed and validated statement by
 * statement).
 *
 * It exists as a shared module because the two sides need the SAME boundaries: the backend
 * used to hand a whole script to drivers that silently ran only the first statement (bun:sqlite
 * `prepare` compiles one statement and ignores the rest; ClickHouse parses the tail of an
 * `INSERT … VALUES` as data), while the editor split the same text differently.
 *
 * A `;` ends a statement only when it is CODE — outside every literal, quoted identifier and
 * comment (the dialect-aware scanner in `sql-regions.ts`), outside parentheses (a PostgreSQL
 * `CREATE RULE … DO (a; b)`), and outside a compound body. Splitting a compound body is the
 * defect the block walk below prevents: a SQLite `CREATE TRIGGER … BEGIN a; b; END`, a MySQL
 * `CREATE PROCEDURE … BEGIN … END`, or a PostgreSQL `BEGIN ATOMIC … END` function body would
 * otherwise reach the engine as several invalid fragments.
 */
import type { DbDialect } from './driver-catalog'
import {
  maskSqlNonCode,
  REDACTION_SQL_GRAMMAR,
  sqlGrammarForDialect,
  type SqlLiteralGrammar,
} from './sql-regions'

export interface SqlStatementSpan {
  /** The statement text (verbatim slice, not trimmed). */
  text: string
  /** Offset of the statement's first character in the source. */
  from: number
  /** Offset just past the statement's last character (before the terminating `;`). */
  to: number
}

/** A statement worth sending to an engine: it contains code, not only comments/whitespace. */
export interface SqlExecutableStatement {
  /** The trimmed statement text, terminator dropped. */
  text: string
  /** Offset of `text`'s first character in the source. */
  start: number
}

function splitGrammar(dialect?: DbDialect): SqlLiteralGrammar {
  const grammar = dialect
    ? sqlGrammarForDialect(dialect)
    : { ...REDACTION_SQL_GRAMMAR, bracketIdentifiers: true }
  // Even though MySQL executes a version-comment body, its delimiters still form one
  // lexical region from the editor's perspective. Splitting inside would tear the
  // `/*! … */` wrapper into two invalid statements.
  return grammar.executableComments ? { ...grammar, executableComments: false } : grammar
}

/** Words after which `BEGIN` is transaction control, never the start of a compound body. */
const TRANSACTION_BEGIN = new Set([
  'TRAN',
  'TRANSACTION',
  'WORK',
  'DISTRIBUTED',
  'DEFERRED',
  'IMMEDIATE',
  'EXCLUSIVE',
])
/** Statements whose `BEGIN` opens a body: routine/trigger DDL and T-SQL control flow. */
const BODY_OWNERS = new Set(['CREATE', 'IF', 'ELSE', 'WHILE'])
/** `END IF` / `END LOOP` … close MySQL constructs that never opened a depth level. */
const UNCOUNTED_END = new Set(['IF', 'LOOP', 'WHILE', 'REPEAT'])
/** `END CASE` / `END TRY` / `END CATCH` consume their follower so it cannot reopen a level. */
const CONSUMED_AFTER_END = new Set(['CASE', 'TRY', 'CATCH'])

const WORD_START = /[A-Za-z_]/
const WORD_CHAR = /[A-Za-z0-9_$]/

/** Offsets of each `;` that terminates a top-level statement. */
export function statementTerminators(text: string, dialect?: DbDialect): number[] {
  const code = maskSqlNonCode(text, splitGrammar(dialect))
  const out: number[] = []
  let depth = 0
  let parens = 0
  let firstWord: string | undefined
  const wordAt = (from: number): { word: string; end: number } | undefined => {
    let index = from
    while (index < code.length && /\s/.test(code[index]!)) index++
    if (!WORD_START.test(code[index] ?? '')) return undefined
    let end = index + 1
    while (end < code.length && WORD_CHAR.test(code[end]!)) end++
    return { word: code.slice(index, end).toUpperCase(), end }
  }
  for (let index = 0; index < code.length; index++) {
    const ch = code[index]!
    if (ch === '(') parens++
    else if (ch === ')') parens = Math.max(0, parens - 1)
    else if (ch === ';') {
      if (parens === 0 && depth === 0) {
        out.push(index)
        firstWord = undefined
      }
    } else if (WORD_START.test(ch) && !WORD_CHAR.test(code[index - 1] ?? ' ')) {
      const { word, end } = wordAt(index)!
      const next = wordAt(end)
      // A statement's FIRST word is never a body opener: `BEGIN;` / `BEGIN TRANSACTION`
      // at the head of a statement is transaction control in every supported dialect.
      const first = firstWord === undefined
      if (first) firstWord = word
      if (word === 'BEGIN') {
        const opens = !first && parens === 0 && (depth > 0 || BODY_OWNERS.has(firstWord!))
        if (opens && !(next && TRANSACTION_BEGIN.has(next.word))) depth++
      } else if (word === 'CASE') {
        depth++
      } else if (word === 'END' && depth > 0 && !(next && UNCOUNTED_END.has(next.word))) {
        depth--
        if (next && CONSUMED_AFTER_END.has(next.word)) {
          index = next.end - 1
          continue
        }
      }
      index = end - 1
    }
  }
  return out
}

/** Every segment between top-level terminators, blank segments included. */
function segments(text: string, dialect?: DbDialect) {
  const out: Array<{ from: number; term: number; terminated: boolean }> = []
  let start = 0
  for (const semi of statementTerminators(text, dialect)) {
    out.push({ from: start, term: semi, terminated: true })
    start = semi + 1
  }
  out.push({ from: start, term: text.length, terminated: false })
  return out
}

/**
 * The statement the caret at `offset` is ON, or `null` when it isn't on one. A statement's
 * "runnable zone" is its first non-whitespace char THROUGH its terminating `;` (plus the rest
 * of that line when nothing else follows on it), or its last non-whitespace char when
 * unterminated. A caret between statements is on none, so Run does nothing rather than run
 * the wrong statement.
 */
export function statementAt(
  text: string,
  offset: number,
  dialect?: DbDialect,
): SqlStatementSpan | null {
  const clamped = Math.max(0, Math.min(offset, text.length))
  for (const seg of segments(text, dialect)) {
    let a = seg.from
    let b = seg.term
    while (a < b && /\s/.test(text[a]!)) a++
    while (b > a && /\s/.test(text[b - 1]!)) b--
    if (b <= a) continue
    let zoneEnd = seg.terminated ? seg.term : b
    if (seg.terminated) {
      let j = seg.term + 1
      while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j++
      if (j >= text.length || text[j] === '\n') zoneEnd = j
    }
    if (clamped >= a && clamped <= zoneEnd) {
      return { text: text.slice(seg.from, seg.term), from: seg.from, to: seg.term }
    }
  }
  return null
}

/** The selection if any, else the statement the caret is ON (a single statement always
 *  runs). Trimmed; `''` when the caret is on no statement of a multi-statement buffer. */
export function statementToRun(
  fullText: string,
  selectedText: string,
  cursorOffset: number,
  dialect?: DbDialect,
): string {
  const sel = selectedText.trim()
  if (sel) return sel
  const all = splitStatements(fullText, dialect)
  if (all.length <= 1) return all[0] ?? ''
  return statementAt(fullText, cursorOffset, dialect)?.text.trim() ?? ''
}

/** All non-empty top-level statements in `text`, trimmed, terminating `;` dropped. */
export function splitStatements(text: string, dialect?: DbDialect): string[] {
  return segments(text, dialect)
    .map((seg) => text.slice(seg.from, seg.term).trim())
    .filter(Boolean)
}

/**
 * The statements an engine should actually receive, with their source offsets. A segment
 * holding only comments is dropped: SQLite rejects an empty prepare, and a trailing
 * `-- note` must not turn a one-statement text into a two-statement script.
 */
export function executableStatements(text: string, dialect?: DbDialect): SqlExecutableStatement[] {
  const code = maskSqlNonCode(text, splitGrammar(dialect))
  const out: SqlExecutableStatement[] = []
  for (const seg of segments(text, dialect)) {
    if (!code.slice(seg.from, seg.term).trim()) continue
    let start = seg.from
    while (start < seg.term && /\s/.test(text[start]!)) start++
    out.push({ text: text.slice(start, seg.term).trimEnd(), start })
  }
  return out
}
