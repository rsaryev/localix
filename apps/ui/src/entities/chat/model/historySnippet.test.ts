import { describe, expect, test } from 'bun:test'
import { parseSnippet } from './historySnippet'

describe('parseSnippet', () => {
  test('splits FTS5 [..]-wrapped matches from surrounding context', () => {
    expect(parseSnippet('…set up [docker] for the [build]…')).toEqual([
      { text: '…set up ', match: false },
      { text: 'docker', match: true },
      { text: ' for the ', match: false },
      { text: 'build', match: true },
      { text: '…', match: false },
    ])
  })

  test('a match at the very start has no leading context segment', () => {
    expect(parseSnippet('[react] hooks')).toEqual([
      { text: 'react', match: true },
      { text: ' hooks', match: false },
    ])
  })

  test('plain text with no match yields one non-match segment', () => {
    expect(parseSnippet('nothing here')).toEqual([{ text: 'nothing here', match: false }])
  })

  test('empty snippet yields no segments', () => {
    expect(parseSnippet('')).toEqual([])
  })
})
