import { describe, expect, test } from 'bun:test'
import { mustFind, namedBody, SubjectNotFoundError } from './scan'

const CODE = `
const before = 1
async function closePosition(symbol) {
  const target = await resolveCloseTarget(ex, symbol)
  if (target.kind === 'ambiguous') throw refuse()
  await ex.closePosition(symbol)
}
async function cancelAllOrders() { await ex.cancelAll() }
`

describe('namedBody', () => {
  test('brace-matches the body, so a reorder or a reformat does not lose the subject', () => {
    const body = namedBody(CODE, /async\s+function\s+closePosition\s*\(/)
    expect(body).toContain('resolveCloseTarget')
    // Closed by brace matching, NOT by the next method's name — so moving `cancelAllOrders` above
    // it, or renaming it, cannot silently widen or truncate the window.
    expect(body).not.toContain('cancelAll()')
  })

  test('THROWS when the subject is gone — it does not hand back an empty scope', () => {
    // The whole class in one assertion. Returning '' here would make every downstream
    // `expect(scope).not.toContain(...)` pass, forever, on a function that no longer exists.
    expect(() => namedBody(CODE, /async\s+function\s+openPosition\s*\(/)).toThrow(
      SubjectNotFoundError,
    )
  })

  test('THROWS on an unbalanced body rather than slicing to EOF', () => {
    expect(() => namedBody('function f() { if (x) {', /function\s+f\s*\(/)).toThrow(
      SubjectNotFoundError,
    )
  })
})

describe('mustFind', () => {
  test('returns the index of a token that is there', () => {
    expect(mustFind(CODE, /resolveCloseTarget/)).toBeGreaterThan(-1)
  })

  test('THROWS instead of returning -1 — an ordering lint on -1 passes by accident', () => {
    // `expect(-1).toBeLessThan(nativeCallIndex)` is green whether or not the guard exists.
    expect(() => mustFind(CODE, /resolveHedgeTarget/)).toThrow(SubjectNotFoundError)
  })
})
