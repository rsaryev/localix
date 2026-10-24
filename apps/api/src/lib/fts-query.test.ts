import { describe, expect, test } from 'bun:test'
import { ftsOrQuery, queryTerms } from './fts-query'

// Russian words, escaped so the source stays ASCII.
const WHERE = 'где' // "where"
const WE = 'мы' // "we"
const DISCUSSED = 'обсуждали' // "discussed"
const RETRIES = 'ретраи' // "retries"

describe('query terms', () => {
  test('drops short words, dedupes, and prefixes inflected Cyrillic words', () => {
    expect(queryTerms(`${WHERE} ${WE} ${DISCUSSED} ${RETRIES} ${RETRIES}`)).toEqual([
      { stem: WHERE, prefix: false },
      { stem: DISCUSSED.slice(0, -1), prefix: true },
      { stem: RETRIES.slice(0, -1), prefix: true },
    ])
  })

  test('only the last Latin word is a prefix while typing', () => {
    expect(queryTerms('docker comp', { prefixLast: true })).toEqual([
      { stem: 'docker', prefix: false },
      { stem: 'comp', prefix: true },
    ])
    expect(ftsOrQuery(queryTerms('docker comp', { prefixLast: true }))).toBe('"docker" OR "comp"*')
  })

  test('what a person types never reaches MATCH as an operator or a column filter', () => {
    expect(ftsOrQuery(queryTerms('name:secret NEAR(foo bar) "quoted'))).toBe(
      '"name" OR "secret" OR "near" OR "foo" OR "bar" OR "quoted"',
    )
    expect(ftsOrQuery(queryTerms('- * ^ ()'))).toBe('')
  })
})
