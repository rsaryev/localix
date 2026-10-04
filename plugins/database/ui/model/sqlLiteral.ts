// Render a JS value as a SQL literal, dialect-aware. Executed row mutations use bind
// parameters; this renderer remains for copied/exported seed SQL and browse filters.
// Those strings must therefore be portable across server modes, not merely safe under
// each engine's default configuration.
import type { DbDialect } from '../dbClient'
import { binaryBytes } from '../../shared/binary-value'
import { stringifyJsonExact } from '../../shared/exact-json'

const utf8 = new TextEncoder()

function utf8Hex(text: string): string {
  let hex = ''
  for (const byte of utf8.encode(text)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

function textLiteral(text: string, dialect: DbDialect): string {
  const doubledQuotes = text.replace(/'/g, "''")

  if (dialect === 'postgres' && text.includes('\\')) {
    // E-strings have the same backslash semantics regardless of
    // standard_conforming_strings. Escaping both characters keeps `\''` from turning
    // the first quote of a doubled pair into the closing delimiter on legacy servers.
    return `E'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
  }

  if (dialect === 'clickhouse') {
    // ClickHouse treats backslash as an escape introducer in every quoted string.
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
  }

  if (dialect === 'mysql' && (text.includes('\\') || hasControlCharacter(text))) {
    // Backslash meaning changes under NO_BACKSLASH_ESCAPES, so no sequence of slash
    // doubling is portable across both modes. A charset-introduced UTF-8 hex literal
    // contains no delimiters supplied by the value and preserves the text in either mode.
    return `_utf8mb4 X'${utf8Hex(text)}'`
  }

  // SQL Server parses an unprefixed literal as VARCHAR through the database codepage
  // before converting it for an NVARCHAR column. N keeps non-ASCII text intact.
  return dialect === 'mssql' ? `N'${doubledQuotes}'` : `'${doubledQuotes}'`
}

export function sqlLiteral(value: unknown, dialect: DbDialect): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean')
    return dialect === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  // A Date must not fall through to String() (which yields "Thu Jul 04 2026 …", not a SQL
  // literal). ISO-8601 compares correctly against real date/time columns.
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? 'NULL' : textLiteral(value.toISOString(), dialect)
  // Binary (blob) → a hex literal in the dialect's syntax, not String()'s comma-joined
  // bytes. Browser callers receive Node Buffers through JSON as
  // `{ type: "Buffer", data: [...] }`, so recognize both representations.
  const bytes = binaryBytes(value)
  if (bytes) {
    let hex = ''
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
    // decode() avoids the two-stage ordinary-string/bytea backslash interpretation and
    // therefore works with either value of standard_conforming_strings.
    if (dialect === 'postgres') return `decode('${hex}', 'hex')`
    if (dialect === 'mssql') return `0x${hex}`
    return `X'${hex}'` // sqlite, mysql
  }
  // A symbol/function has no SQL representation; an object (a jsonb/array column) is JSON.
  if (typeof value === 'symbol' || typeof value === 'function') return 'NULL'
  const text = typeof value === 'string' ? value : stringifyJsonExact(value)
  return text === undefined ? 'NULL' : textLiteral(text, dialect)
}
