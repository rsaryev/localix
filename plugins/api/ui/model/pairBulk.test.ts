import { describe, expect, test } from 'bun:test'
import type { Pair } from '../../backend/request-spec'
import { pairsToText, textToPairs } from './pairBulk'

describe('pairsToText', () => {
  test('one `name: value` line per pair', () => {
    expect(
      pairsToText([
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Trace', value: '1' },
      ]),
    ).toBe('Accept: application/json\nX-Trace: 1')
  })

  test('a disabled row is `#`-prefixed', () => {
    expect(pairsToText([{ name: 'Authorization', value: 'Bearer x', disabled: true }])).toBe(
      '#Authorization: Bearer x',
    )
  })
})

describe('textToPairs', () => {
  test('splits on the first `:`; value keeps later colons', () => {
    expect(textToPairs('Authorization: Bearer a:b')).toEqual([
      { name: 'Authorization', value: 'Bearer a:b' },
    ])
  })

  test('a leading `#` disables the row (with or without a space)', () => {
    expect(textToPairs('#Accept: text/html')).toEqual([
      { name: 'Accept', value: 'text/html', disabled: true },
    ])
    expect(textToPairs('# Accept: text/html')).toEqual([
      { name: 'Accept', value: 'text/html', disabled: true },
    ])
  })

  test('accepts `=` as a delimiter; earliest of `:`/`=` wins', () => {
    expect(textToPairs('page=2')).toEqual([{ name: 'page', value: '2' }])
    // `:` comes before `=` here, so it is the split point and the value keeps the `=`.
    expect(textToPairs('a: b=c')).toEqual([{ name: 'a', value: 'b=c' }])
  })

  test('blank lines are skipped; a delimiter-less line is all-name', () => {
    expect(textToPairs('Accept: json\n\n   \nnovalue')).toEqual([
      { name: 'Accept', value: 'json' },
      { name: 'novalue', value: '' },
    ])
  })
})

describe('round-trip', () => {
  test('textToPairs ∘ pairsToText is identity on well-formed pairs', () => {
    const pairs: Pair[] = [
      { name: 'Accept', value: 'application/json' },
      { name: 'Authorization', value: 'Bearer token', disabled: true },
      { name: 'X-Empty', value: '' },
    ]
    expect(textToPairs(pairsToText(pairs))).toEqual(pairs)
  })
})
