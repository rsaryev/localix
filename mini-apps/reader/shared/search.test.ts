import { describe, expect, test } from 'bun:test'

import { searchReaderChapters, type ReaderSearchOptions } from './search'

const chapters = [
  {
    index: 0,
    title: 'Opening',
    text: 'Café agents connect tools. Agents can also connect people and systems.',
  },
  {
    index: 1,
    title: 'Architecture',
    text: 'A resilient mesh keeps every agent observable. agentic systems need boundaries.',
  },
]

const options = (overrides: Partial<ReaderSearchOptions> = {}): ReaderSearchOptions => ({
  query: 'agent',
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 10,
  limit: 200,
  ...overrides,
})

describe('reader full-text search', () => {
  test('groups literal matches by chapter and preserves original text', () => {
    const result = searchReaderChapters(chapters, options())
    expect(result.total).toBe(4)
    expect(result.groups.map((group) => group.chapterTitle)).toEqual(['Opening', 'Architecture'])
    expect(result.groups[0]?.matches[0]?.match).toBe('agent')
  })

  test('supports chapter scope and diacritic folding', () => {
    const result = searchReaderChapters(
      chapters,
      options({ query: 'cafe', scope: 'chapter', chapter: 0 }),
    )
    expect(result.total).toBe(1)
    expect(result.groups[0]?.matches[0]?.match).toBe('Café')
  })

  test('distinguishes whole words from contains', () => {
    expect(searchReaderChapters(chapters, options({ mode: 'whole-words' })).total).toBe(1)
    expect(
      searchReaderChapters(chapters, options({ query: 'agents', mode: 'whole-words' })).total,
    ).toBe(2)
  })

  test('finds terms within a bounded word window', () => {
    const result = searchReaderChapters(
      chapters,
      options({ query: 'connect systems', mode: 'nearby-words', nearbyWords: 8 }),
    )
    expect(result.total).toBe(1)
    expect(result.groups[0]?.matches[0]?.match).toContain('connect')
    expect(result.groups[0]?.matches[0]?.match).toContain('systems')
  })

  test('supports bounded regular expressions and rejects risky patterns', () => {
    expect(
      searchReaderChapters(chapters, options({ query: 'agent(s|ic)', mode: 'regex' })).total,
    ).toBe(3)
    expect(() =>
      searchReaderChapters(chapters, options({ query: '(a+)+$', mode: 'regex' })),
    ).toThrow('too complex')
  })

  test('enforces result caps deterministically', () => {
    const result = searchReaderChapters(chapters, options({ limit: 2 }))
    expect(result.total).toBe(2)
    expect(result.truncated).toBe(true)
  })
})
