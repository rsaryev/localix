import { describe, expect, test } from 'bun:test'
import { ftsOrQuery, queryTerms } from './fts-query'

// Russian words, escaped so the source stays ASCII.
const WHERE = '\u0433\u0434\u0435' // "where"
const WE = '\u043c\u044b' // "we"
const DISCUSSED = '\u043e\u0431\u0441\u0443\u0436\u0434\u0430\u043b\u0438' // "discussed"
const RETRIES = '\u0440\u0435\u0442\u0440\u0430\u0438' // "retries"

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
