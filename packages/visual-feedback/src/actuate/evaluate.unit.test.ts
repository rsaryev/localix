import { afterEach, describe, expect, test } from 'bun:test'

import { MAX_EVAL_CHARS, serializeEvalResult, compileEvalExpression } from './evaluate'

// The snippet below writes onto the shared global.
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__vfEvalX
})

describe('serializeEvalResult', () => {
  test('passes strings through', () => {
    expect(serializeEvalResult('hello')).toBe('hello')
  })

  test('renders nullish + primitives', () => {
    expect(serializeEvalResult(undefined)).toBe('undefined')
    expect(serializeEvalResult(null)).toBe('null')
    expect(serializeEvalResult(42)).toBe('42')
    expect(serializeEvalResult(true)).toBe('true')
    expect(serializeEvalResult(7n)).toBe('7')
  })

  test('names functions', () => {
    function namedFn() {}
    expect(serializeEvalResult(namedFn)).toBe('[function namedFn]')
    expect(serializeEvalResult(() => {})).toContain('[function')
  })

  test('pretty-prints plain objects as JSON', () => {
    expect(serializeEvalResult({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  test('breaks circular references instead of throwing', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(serializeEvalResult(a)).toContain('[Circular]')
  })

  test('serializes bigint inside objects', () => {
    expect(serializeEvalResult({ n: 9n })).toContain('"9"')
  })

  test('caps oversized output', () => {
    const big = 'x'.repeat(MAX_EVAL_CHARS + 100)
    const out = serializeEvalResult(big)
    expect(out.length).toBeLessThan(big.length)
    expect(out).toContain('[truncated')
  })
})

describe('compileEvalExpression', () => {
  test('runs a bare expression', async () => {
    expect(await compileEvalExpression('1 + 1')()).toBe(2)
  })

  test('falls back to a statement body when the expression form is a syntax error', async () => {
    expect(await compileEvalExpression('const x = 3; return x * 2;')()).toBe(6)
  })

  test('supports await in the expression path', async () => {
    expect(await compileEvalExpression('await Promise.resolve(5)')()).toBe(5)
  })

  test('a MULTI-STATEMENT snippet returns the last statement completion value (not undefined)', async () => {
    // The old bug: `a; b` used to run but return undefined (no completion value).
    expect(await compileEvalExpression('1 + 1; 2 + 2')()).toBe(4)
  })

  test('multi-statement can mutate then read shared state, returning the read value', async () => {
    const g = globalThis as Record<string, unknown>
    delete g.__vfEvalX
    // Mirrors "toggleTheme(); getAttr()": a side effect then a value read.
    expect(
      await compileEvalExpression('globalThis.__vfEvalX = 7; globalThis.__vfEvalX + 1')(),
    ).toBe(8)
    expect(g.__vfEvalX).toBe(7)
  })

  test('a thrown error REJECTS (never resolves to undefined)', async () => {
    expect(compileEvalExpression('throw new Error("boom")')()).rejects.toThrow('boom')
    // …including from a multi-statement snippet run via the eval path.
    expect(compileEvalExpression('const y = 1; null.z')()).rejects.toThrow(TypeError)
  })

  test('multi-statement + top-level await falls to undefined (documented eval limitation)', async () => {
    // eval cannot parse top-level await → statement-body path runs it but has no
    // completion value. This locks the documented boundary of the fallback.
    expect(await compileEvalExpression('await Promise.resolve(1); 2 + 2')()).toBeUndefined()
  })
})
