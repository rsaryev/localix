import { describe, expect, test } from 'bun:test'
import { queryTerms } from '../../lib/fts-query'
import { fuse, isLookupQuery, unitScore, wordCoverage } from './hybrid'

// Russian words, escaped so the source stays ASCII.
const RETRIES = 'ретраи' // "retries"
const RETRIES_GENITIVE = '\u0440\u0435\u0442\u0440\u0430\u0435\u0432' // "of retries"
const WEBHOOKS_GENITIVE = '\u0432\u0435\u0431\u0445\u0443\u043a\u043e\u0432' // "of webhooks"
const CONFIGURED = '\u041d\u0430\u0441\u0442\u0440\u043e\u0438\u043b\u0438' // "configured"

describe('word evidence', () => {
  test('coverage counts whole words and word starts', () => {
    const terms = queryTerms(`${RETRIES} ${WEBHOOKS_GENITIVE} stripe`)
    expect(
      wordCoverage(terms, `${CONFIGURED} ${RETRIES_GENITIVE} ${WEBHOOKS_GENITIVE}`),
    ).toBeCloseTo(2 / 3)
    expect(wordCoverage(terms, 'nothing here')).toBe(0)
  })

  test('a query of codes and numbers is a lookup', () => {
    expect(isLookupQuery(queryTerms('ERR402 TRX50'))).toBe(true)
    expect(isLookupQuery(queryTerms('4815162342'))).toBe(true)
    expect(isLookupQuery(queryTerms('payment error 402'))).toBe(false)
  })
})

describe('fuse', () => {
  test('a candidate needs a meaning standout or half the words', () => {
    const fused = fuse(
      [
        { key: 'meaning', z: 3.1, coverage: 0 },
        { key: 'words', z: 0.2, coverage: 1 },
        { key: 'one-common-word', z: 0.5, coverage: 0.34 },
        { key: 'noise', z: 1.2 },
      ],
      { zGate: 2 },
    )
    expect(fused.map((f) => [f.key, f.matchedBy])).toEqual([
      ['meaning', 'meaning'],
      ['words', 'words'],
    ])
  })

  test('meaning and words together beat either alone', () => {
    const fused = fuse(
      [
        { key: 'both', z: 2.5, coverage: 1 },
        { key: 'meaning', z: 3.5 },
        { key: 'words', coverage: 1 },
      ],
      { zGate: 2 },
    )
    expect(fused[0]!).toMatchObject({ key: 'both', matchedBy: 'both' })
  })

  test('a lookup query lets exact words outrank a strong meaning match', () => {
    const inputs = [
      { key: 'exact', z: 0, coverage: 1 },
      { key: 'similar', z: 4.5, coverage: 0 },
    ]
    expect(fuse(inputs, { zGate: 2 })[0]!.key).toBe('similar')
    expect(fuse(inputs, { zGate: 2, lookup: true })[0]!.key).toBe('exact')
  })

  test('scores map into (0, 1)', () => {
    expect(unitScore(0)).toBe(0)
    expect(unitScore(100)).toBeLessThan(1)
  })
})
