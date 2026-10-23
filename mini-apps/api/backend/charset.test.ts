/**
 * Decoding a response as the server encoded it.
 *
 * The group that matters is the last one: the runtime CANNOT do every label (`utf-7`,
 * `iso-2022-kr`), so the claim being pinned is not "we decode everything" — it is "we never garble
 * a body silently".
 */

import { describe, expect, test } from 'bun:test'
import { canDecode, charsetOf, decodingPlan } from './charset'

describe('charsetOf', () => {
  test.each([
    ['text/html; charset=ISO-8859-1', 'iso-8859-1'],
    ['text/plain;charset=utf-8', 'utf-8'],
    ['text/plain; charset="utf-8"', 'utf-8'],
    ['text/plain; charset = UTF-8', 'utf-8'],
    ['application/json; charset=Shift_JIS', 'shift_jis'],
    ['text/html; boundary=x; charset=gbk', 'gbk'],
  ])('%p → %p', (header, expected) => {
    expect(charsetOf(header)).toBe(expected)
  })

  test.each([
    ['application/json', 'no charset parameter'],
    ['', 'empty'],
    [null, 'absent header'],
    [undefined, 'undefined'],
    // `charsetfoo=x` must not be read as a charset.
    ['text/plain; charsetfoo=utf-8', 'a parameter that merely starts with charset'],
  ])('%p → null (%s)', (header) => {
    expect(charsetOf(header)).toBeNull()
  })
})

describe('canDecode asks the runtime, it does not keep a list', () => {
  // A hardcoded list of supported labels would be the same knowledge in two places, drifting the
  // moment the runtime changes. Constructing a decoder is the only answer that cannot be stale.
  test.each(['utf-8', 'iso-8859-1', 'shift_jis', 'gbk', 'euc-kr', 'windows-1251', 'koi8-r'])(
    '%p is supported here',
    (l) => {
      expect(canDecode(l)).toBe(true)
    },
  )

  test.each(['utf-7', 'iso-2022-kr', 'not-a-charset', ''])('%p is not', (l) => {
    expect(canDecode(l)).toBe(false)
  })
})

describe('decodingPlan', () => {
  test('no charset → utf-8, and NO warning: that is the right default for HTTP', () => {
    expect(decodingPlan('application/json')).toEqual({ label: 'utf-8', problem: null })
    expect(decodingPlan(null)).toEqual({ label: 'utf-8', problem: null })
  })

  test.each(['iso-8859-1', 'shift_jis', 'gbk', 'windows-1251'])(
    'a supported %p is honoured, silently',
    (label) => {
      expect(decodingPlan(`text/plain; charset=${label}`)).toEqual({ label, problem: null })
    },
  )

  describe('a charset the runtime cannot do is NAMED, never silently garbled', () => {
    test.each(['utf-7', 'iso-2022-kr'])('%p falls back to utf-8 AND warns', (label) => {
      const plan = decodingPlan(`text/plain; charset=${label}`)
      // The fallback must be a label the runtime accepts, or the send throws RangeError instead of
      // returning a garbled body — a worse outcome than the bug being fixed.
      expect(plan.label).toBe('utf-8')
      expect(canDecode(plan.label)).toBe(true)
      expect(plan.problem).toContain(label)
    })

    test("the warning says it is NOT the server's fault — the whole point", () => {
      // Without this, an agent reads mojibake and reports the API as broken, or "fixes" an
      // encoding problem that exists only in our reader.
      const plan = decodingPlan('text/plain; charset=utf-7')
      expect(plan.problem).toContain('WRONG')
      expect(plan.problem).toContain("not the server's fault")
    })
  })

  test('a nonsense charset is treated as unsupported, not fatal', () => {
    expect(decodingPlan('text/plain; charset=%%%').label).toBe('utf-8')
  })
})
