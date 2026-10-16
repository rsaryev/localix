/**
 * `pairValue` — Postman's key/value coercion.
 *
 * Found by a MUTATION sweep: neutralising the number/boolean branch left all 898 tests green.
 * What makes it worth recording is that this exact coercion exists in THREE places —
 * `openapi/example.ts`, `postman/auth.ts` and here — and the mutation was killed in the other two.
 * The same knowledge, copied three times, tested twice. A duplicated line that AGREES is invisible
 * until one copy drifts, and the copy with no test is the one free to drift.
 */

import { describe, expect, test } from 'bun:test'
import { pairValue } from './types'

describe('pairValue', () => {
  test.each([
    ['a string', { key: 'k', value: 'v' }, 'v'],
    ['an empty string', { key: 'k', value: '' }, ''],
  ])('%s is passed through', (_label, pair, expected) => {
    expect(pairValue(pair as never)).toBe(expected)
  })

  describe('Postman puts non-strings here in the wild — that is the whole reason this exists', () => {
    test.each([
      ['a number', 8080, '8080'],
      ['zero', 0, '0'],
      ['a float', 1.5, '1.5'],
      ['true', true, 'true'],
      ['false', false, 'false'],
    ])('%s becomes its text (%p → %p)', (_label, value, expected) => {
      // Without the coercion these fall to '' — a port, a page number or a flag silently
      // disappears from an imported request and the failure surfaces at the server.
      expect(pairValue({ key: 'k', value } as never)).toBe(expected)
    })
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an object', { a: 1 }],
    ['an array', [1]],
  ])('%s becomes an empty string rather than "[object Object]"', (_label, value) => {
    expect(pairValue({ key: 'k', value } as never)).toBe('')
  })
})
