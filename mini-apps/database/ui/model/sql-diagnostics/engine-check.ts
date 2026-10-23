/**
 * The engine's compile-only verdict, as editor ranges.
 *
 * The live checks know the cached schema, not the grammar: `SELEC * FROM users` passed them and
 * failed only when run. The backend asks the engine to compile each statement without executing it
 * (`POST /:id/validate`); this turns its per-statement answer into underlines.
 *
 * Where the engine reports a position, the word at that offset is marked; where it does not, the
 * statement's first line is — a whole-statement squiggle across a 40-line query reads as noise.
 * A skipped verdict (busy engine, a statement kind that cannot be compiled side-effect free, a
 * name an earlier statement of the same script creates) marks nothing: it says nothing about SQL.
 */
import type { ValidateResponse } from '../../dbClient'

export interface EngineProblemRange {
  start: number
  end: number
  message: string
}

const WORD = /[A-Za-z0-9_$"`[\]]/

function wordAt(sql: string, offset: number): { start: number; end: number } {
  let start = Math.min(Math.max(0, offset), sql.length)
  let end = start
  while (end < sql.length && WORD.test(sql[end]!)) end++
  if (end === start) {
    // The engine pointed at punctuation or whitespace: take the next non-blank character.
    while (end < sql.length && /\s/.test(sql[end]!)) end++
    start = end
    end = Math.min(sql.length, end + 1)
  }
  return { start, end: Math.max(end, start + 1) }
}

function firstLine(sql: string, start: number): { start: number; end: number } {
  const newline = sql.indexOf('\n', start)
  return { start, end: newline < 0 ? sql.length : newline }
}

export function engineProblemRanges(sql: string, response: ValidateResponse): EngineProblemRange[] {
  if (!response.supported) return []
  return response.results.flatMap((result) => {
    if (result.ok || !result.message) return []
    const range =
      result.offset !== undefined
        ? wordAt(sql, result.offset)
        : firstLine(sql, result.statementStart)
    return [{ ...range, message: result.message }]
  })
}
