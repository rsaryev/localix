import { describe, expect, it } from 'bun:test'
import { sqlLiteral } from './sqlLiteral'

describe('sqlLiteral', () => {
  it('renders null/undefined as NULL', () => {
    expect(sqlLiteral(null, 'sqlite')).toBe('NULL')
    expect(sqlLiteral(undefined, 'postgres')).toBe('NULL')
  })

  it('renders finite numbers bare and non-finite as NULL', () => {
    expect(sqlLiteral(42, 'sqlite')).toBe('42')
    expect(sqlLiteral(-3.5, 'mysql')).toBe('-3.5')
    expect(sqlLiteral(Number.NaN, 'sqlite')).toBe('NULL')
    expect(sqlLiteral(Infinity, 'postgres')).toBe('NULL')
  })

  it('renders bigint bare', () => {
    expect(sqlLiteral(9007199254740993n, 'postgres')).toBe('9007199254740993')
  })

  it('renders booleans per dialect', () => {
    expect(sqlLiteral(true, 'postgres')).toBe('TRUE')
    expect(sqlLiteral(false, 'postgres')).toBe('FALSE')
    expect(sqlLiteral(true, 'sqlite')).toBe('1')
    expect(sqlLiteral(false, 'mysql')).toBe('0')
  })

  it('escapes single quotes by doubling', () => {
    expect(sqlLiteral("O'Brien", 'sqlite')).toBe("'O''Brien'")
  })

  it('renders backslashes independently of PostgreSQL/MySQL server modes', () => {
    expect(sqlLiteral('a\\b', 'mysql')).toBe("_utf8mb4 X'615c62'")
    expect(sqlLiteral('a\\b', 'postgres')).toBe("E'a\\\\b'")
    expect(sqlLiteral('a\\b', 'clickhouse')).toBe("'a\\\\b'")
  })

  // Security: a value that tries to break out of the string must stay ONE quoted literal
  // (or a delimiter-free hex value) — never runnable SQL.
  it('neutralizes a SQL-injection attempt into a single quoted literal', () => {
    const attack = "'); DROP TABLE users; --"
    expect(sqlLiteral(attack, 'postgres')).toBe("'''); DROP TABLE users; --'")
    expect(sqlLiteral(attack, 'sqlite')).toBe("'''); DROP TABLE users; --'")
    const backslashAttack = "\\'; DROP TABLE users; --"
    expect(sqlLiteral(backslashAttack, 'postgres')).toBe("E'\\\\''; DROP TABLE users; --'")
    expect(sqlLiteral(backslashAttack, 'mysql')).toBe(
      "_utf8mb4 X'5c273b2044524f50205441424c452075736572733b202d2d'",
    )
    expect(sqlLiteral(backslashAttack, 'clickhouse')).toBe("'\\\\''; DROP TABLE users; --'")
  })

  it('renders binary (Uint8Array) without mode-sensitive PostgreSQL backslashes', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x1a])
    expect(sqlLiteral(bytes, 'sqlite')).toBe("X'00ff1a'")
    expect(sqlLiteral(bytes, 'mysql')).toBe("X'00ff1a'")
    expect(sqlLiteral(bytes, 'postgres')).toBe("decode('00ff1a', 'hex')")
    expect(sqlLiteral(bytes, 'mssql')).toBe('0x00ff1a')
    expect(sqlLiteral(new Uint8Array([]), 'sqlite')).toBe("X''")
  })

  it('renders a Buffer after JSON transport as binary, not as a JSON document', () => {
    const transported = { type: 'Buffer', data: [0x00, 0xff, 0x1a] }
    expect(sqlLiteral(transported, 'sqlite')).toBe("X'00ff1a'")
    expect(sqlLiteral(transported, 'postgres')).toBe("decode('00ff1a', 'hex')")
    expect(sqlLiteral(transported, 'mssql')).toBe('0x00ff1a')
  })

  it('does not mistake an invalid Buffer-like JSON document for binary', () => {
    expect(sqlLiteral({ type: 'Buffer', data: [256] }, 'sqlite')).toBe(
      `'{"type":"Buffer","data":[256]}'`,
    )
  })

  it('renders nested bigint JSON without throwing or rounding', () => {
    expect(sqlLiteral({ safe: 42n, wide: 9007199254740993n }, 'postgres')).toBe(
      `'{"safe":42,"wide":"9007199254740993"}'`,
    )
  })

  it('renders a Date as an ISO literal, not JS toString', () => {
    const d = new Date('2026-07-04T12:30:00.000Z')
    expect(sqlLiteral(d, 'postgres')).toBe("'2026-07-04T12:30:00.000Z'")
    expect(sqlLiteral(new Date(Number.NaN), 'sqlite')).toBe('NULL')
  })

  it('prefixes SQL Server text with N so non-ASCII survives the parse', () => {
    // THE BUG: an unprefixed literal is VARCHAR, converted through the database's default
    // collation codepage BEFORE it reaches the column — under the common Latin1 default
    // every non-ASCII character became a literal `?`, NVARCHAR column or not. The row
    // editor and CSV import both write through here, so this silently corrupted data.
    expect(sqlLiteral('你好', 'mssql')).toBe("N'你好'")
    expect(sqlLiteral("it's", 'mssql')).toBe("N'it''s'")
  })

  it('does NOT prefix any other dialect — the reverse direction', () => {
    // N is mssql-only and must stay that way: postgres rejects `N'…'` outright, and in
    // MySQL it selects the national character set, which is a different statement than
    // the one we mean. A blanket prefix would trade silent corruption for hard errors.
    expect(sqlLiteral('你好', 'postgres')).toBe("'你好'")
    expect(sqlLiteral('你好', 'mysql')).toBe("'你好'")
    expect(sqlLiteral('你好', 'sqlite')).toBe("'你好'")
  })

  it('leaves the mssql binary literal unprefixed', () => {
    // The other over-reach guard: `0x…` is not a string literal, and `N0x…` is nonsense.
    expect(sqlLiteral(new Uint8Array([0, 255]), 'mssql')).toBe('0x00ff')
  })
})
