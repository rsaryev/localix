/**
 * The name a database's own error message blames — `relation "usres" does not exist`,
 * `no such column: nme`, `Incorrect syntax near 'FORM'` — so the editor can underline it.
 *
 * Why the NAME and not the engine's character position: only Postgres reports a position, and
 * it is an offset into the text the ENGINE received — after `?` placeholders were rewritten to
 * `$1`, after an EXPLAIN wrapper — so it lands on the wrong character of the editor's text. The
 * name is the same in both texts. Every engine the mini app speaks names the offender in one of a
 * few fixed sentences; an unrecognised message yields `null` and nothing is underlined.
 */
export type EngineErrorKind = 'table' | 'column' | 'alias' | 'syntax'

export interface EngineErrorName {
  kind: EngineErrorKind
  /** The blamed identifier, last part only (`u.nmae` → `nmae`), or the syntax error's token. */
  name: string
  /** Its qualifier when the message gave one (`u` of `u.nmae`). */
  qualifier?: string
}

const PATTERNS: Array<[EngineErrorKind, RegExp]> = [
  // Postgres
  ['table', /relation "([^"]+)" does not exist/i],
  ['column', /column "([^"]+)"(?: of relation "[^"]+")? does not exist/i],
  ['column', /column ([\w$.]+) does not exist/i],
  ['alias', /missing FROM-clause entry for table "([^"]+)"/i],
  ['table', /Table with name ([^\s!]+) does not exist/i],
  ['table', /Referenced table "([^"]+)" not found/i],
  ['column', /Referenced column "([^"]+)" not found/i],
  ['syntax', /syntax error at or near "([^"]+)"/i],
  // MySQL, MariaDB
  ['table', /Table '([^']+)' doesn't exist/i],
  ['column', /Unknown column '([^']+)' in/i],
  ['syntax', /right syntax to use near '(\S+)/i],
  // SQLite
  ['table', /no such table: ([\w$.]+)/i],
  ['column', /no such column: ([\w$.]+)/i],
  ['syntax', /near "([^"]+)": syntax error/i],
  // SQL Server
  ['table', /Invalid object name '([^']+)'/i],
  ['column', /Invalid column name '([^']+)'/i],
  ['alias', /The multi-part identifier "([^"]+)" could not be bound/i],
  ['syntax', /Incorrect syntax near '([^']+)'/i],
  // ClickHouse
  ['table', /Unknown table expression identifier '([^']+)'/i],
  ['table', /Table ([\w$.]+) does not exist/i],
  ['column', /Missing columns: '([^']+)'/i],
  ['column', /Unknown expression (?:or function )?identifier [`']([^`']+)[`']/i],
  ['syntax', /Syntax error: failed at position \d+ \(['`]?([^'`)\s]+)/i],
]

export function engineErrorName(message: string): EngineErrorName | null {
  for (const [kind, pattern] of PATTERNS) {
    const raw = pattern.exec(message)?.[1]
    if (!raw) continue
    // `db.table`, `u.nmae`: the editor shows the last part; for a multi-part identifier that
    // could not be bound (SQL Server) the whole reference is the problem, but its qualifier is
    // what is unknown, so that is what gets blamed.
    const parts = raw.split('.').filter(Boolean)
    if (kind === 'alias' && parts.length > 1) return { kind, name: parts[0]! }
    const name = parts.at(-1) ?? raw
    return parts.length > 1 ? { kind, name, qualifier: parts.at(-2)! } : { kind, name }
  }
  return null
}
