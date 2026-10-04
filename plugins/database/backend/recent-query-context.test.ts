import { describe, expect, it } from 'bun:test'
import {
  recordRecentQuery,
  renderRecentQueriesForContext,
  sanitizeQueryForContext,
} from './recent-query-context'

describe('recent query context', () => {
  it('keeps SQL shape while removing string and number literals', () => {
    expect(
      sanitizeQueryForContext(
        "SELECT * FROM users /* private note */ WHERE email = 'private@example.com' AND id = 42 -- secret",
      ),
    ).toBe("SELECT * FROM users WHERE email = '…' AND id = ?")
  })

  it('removes PostgreSQL dollar-quoted values', () => {
    expect(sanitizeQueryForContext('SELECT $$private value$$, $tag$other value$tag$')).toBe(
      'SELECT $…$, $…$',
    )
  })

  it('keeps Mongo/Elasticsearch field structure but removes every JSON value', () => {
    const mongo = sanitizeQueryForContext(
      'db.users.find({"email":"private@example.com","age":{"$gt":42},"tenant":"acme"})',
      'document',
    )
    expect(mongo).toContain('db.users.find')
    expect(mongo).toContain('"email"')
    expect(mongo).toContain('"$gt"')
    expect(mongo).not.toContain('private@example.com')
    expect(mongo).not.toContain('acme')
    expect(mongo).not.toContain('42')

    const search = sanitizeQueryForContext(
      'products.search({"query":{"match":{"description":"internal launch"}}})',
      'search',
    )
    expect(search).toContain('"description"')
    expect(search).not.toContain('internal launch')
  })

  it('keeps only Redis command shape, never keys or values', () => {
    expect(sanitizeQueryForContext('SET session:alice "top secret"', 'kv')).toBe('SET ? ?')
    expect(sanitizeQueryForContext('HGET customer:42 email', 'kv')).toBe('HGET ? ?')
  })

  // Two verbatim-leak regressions, each reproduced with a planted token before the fix.
  // The point of the sanitizer is that NOTHING from a literal reaches agent context, so
  // these assert on the planted value rather than only on the expected shape.
  const PLANTED = 'SECRET-TOKEN-abc123'

  it('does not leak a literal whose closing quote is backslash-escaped', () => {
    // MySQL and ClickHouse read `\'` as an escaped quote. The old literal pattern knew
    // `''` but not `\'`, so it "ended" the literal at that quote and emitted the rest —
    // the secret — as code: `'…'s SECRET-TOKEN-abc123'`.
    const out = sanitizeQueryForContext(String.raw`SELECT * FROM t WHERE note = 'it\'s ${PLANTED}'`)
    expect(out).not.toContain(PLANTED)
    expect(out).toBe("SELECT * FROM t WHERE note = '…'")
  })

  it('does not leak a literal that contains a -- sequence', () => {
    // The comment pass used to run BEFORE the literal pass and cut from `--` to end of
    // line, truncating the literal so the literal pass no longer matched it. Output was
    // `SELECT 'xSECRET-TOKEN-abc123`. Dialect-independent.
    const out = sanitizeQueryForContext(`SELECT 'x${PLANTED}--' , 'y'`)
    expect(out).not.toContain(PLANTED)
    expect(out).toBe("SELECT '…' , '…'")
  })

  it('does not leak a literal containing a /* sequence, and keeps real comments out', () => {
    const withBlockStart = sanitizeQueryForContext(`SELECT 'a/*${PLANTED}' , 'b'`)
    expect(withBlockStart).not.toContain(PLANTED)
    expect(withBlockStart).toBe("SELECT '…' , '…'")
    // A real comment is still removed, and a literal after it still redacted.
    expect(sanitizeQueryForContext(`SELECT /* ${PLANTED} */ 'v'`)).not.toContain(PLANTED)
  })

  it('redacts a literal hidden inside a bracketed span rather than preserving it', () => {
    // `[…]` is an identifier in T-SQL but an array literal in ClickHouse, and the
    // sanitizer does not know the dialect. Treating it as an identifier would PRESERVE a
    // string sitting inside it, so redaction deliberately does not skip brackets.
    const out = sanitizeQueryForContext(`SELECT ['${PLANTED}'] FROM t`)
    expect(out).not.toContain(PLANTED)
  })

  it('redacts double-quoted spans because supported engines can treat them as values', () => {
    const out = sanitizeQueryForContext(`SELECT "${PLANTED}" FROM "Users" WHERE a = 'x'`)
    expect(out).not.toContain(PLANTED)
    expect(out).toBe(`SELECT "…" FROM "…" WHERE a = '…'`)
  })

  it('keeps unambiguous backtick identifiers', () => {
    expect(sanitizeQueryForContext("SELECT `userEmail` FROM `Users` WHERE a = 'x'")).toBe(
      "SELECT `userEmail` FROM `Users` WHERE a = '…'",
    )
  })

  it('stores newest-first sanitized query shapes without duplicates', () => {
    const first = recordRecentQuery([], 'SELECT * FROM users WHERE id = 1')
    const second = recordRecentQuery(first, 'SELECT * FROM users WHERE id = 2')
    expect(second).toEqual(['SELECT * FROM users WHERE id = ?'])
  })

  it('renders only whole bounded query blocks', () => {
    expect(renderRecentQueriesForContext(['SELECT 1', 'SELECT 2'], 12)).toBe('SELECT 1;')
  })
})
