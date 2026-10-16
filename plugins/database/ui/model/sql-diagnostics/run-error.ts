/**
 * Where, in the editor's text, the statement that just FAILED is wrong.
 *
 * The console knows the statement it sent and the engine's message; the editor knows its buffer.
 * The statement is found in the buffer by its text — nearest the cursor when a script repeats it —
 * and the name the engine blamed is found among that statement's tokens. When the statement no
 * longer appears verbatim the user has edited it, so the finding is stale and there is no range:
 * a marker must never outlive the text it described.
 */
import type { DbDialect } from '../../../shared/driver-catalog'
import { engineErrorName } from './engine-error'
import { isIdent, tokenizeSql } from './tokens'

export interface SqlRunFailure {
  /** The statement as it was run (trimmed). */
  sql: string
  /** The engine's own text — what names the offender. */
  message: string
}

export interface SqlRunErrorRange {
  start: number
  end: number
  message: string
}

function statementOffset(buffer: string, sql: string, near: number): number {
  let best = -1
  for (let at = buffer.indexOf(sql); at >= 0; at = buffer.indexOf(sql, at + 1)) {
    const distance = near < at ? at - near : Math.max(0, near - (at + sql.length))
    const bestDistance =
      best < 0 ? Infinity : near < best ? best - near : Math.max(0, near - (best + sql.length))
    if (distance < bestDistance) best = at
  }
  return best
}

export function locateRunError(
  buffer: string,
  failure: SqlRunFailure,
  dialect: DbDialect,
  near = 0,
): SqlRunErrorRange | null {
  if (!failure.sql) return null
  const offset = statementOffset(buffer, failure.sql, near)
  if (offset < 0) return null
  const tokens = tokenizeSql(failure.sql, dialect)
  if (tokens.length === 0) return null
  const blamed = engineErrorName(failure.message)
  const named = blamed
    ? tokens.filter((token) =>
        blamed.kind === 'syntax'
          ? token.text.toLowerCase() === blamed.name.toLowerCase()
          : isIdent(token) && token.name.toLowerCase() === blamed.name.toLowerCase(),
      )
    : []
  // `u.nmae` names one occurrence exactly; prefer it, but a qualifier the text spells otherwise
  // (the engine expanded an alias) still leaves the bare name as the best evidence.
  const qualified = blamed?.qualifier
    ? named.filter((token) => {
        const i = tokens.indexOf(token)
        return (
          tokens[i - 1]?.text === '.' &&
          tokens[i - 2]?.name.toLowerCase() === blamed.qualifier!.toLowerCase()
        )
      })
    : []
  // Unrecognised message, or a name the text does not spell the same way: the statement still
  // failed, so its first token carries the message rather than nothing at all.
  const target = qualified[0] ?? named[0] ?? tokens[0]!
  return { start: offset + target.start, end: offset + target.end, message: failure.message }
}
