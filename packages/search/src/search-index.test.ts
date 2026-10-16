import { describe, expect, test } from 'bun:test'
import { createSearchIndex, rankSearchCandidates } from './index'

const candidates = [
  { item: 'theme', fields: [{ text: 'Theme picker' }, { text: 'Change colors', weight: 0.5 }] },
  { item: 'plugins', fields: [{ text: 'Plugins' }, { text: 'Install extensions', weight: 0.5 }] },
  { item: 'terminal', fields: [{ text: 'Terminal' }, { text: 'Run the shell', weight: 0.5 }] },
]

describe('createSearchIndex', () => {
  test('ranks repeated queries identically to the one-shot ranker', () => {
    const index = createSearchIndex(candidates)
    expect(index.size).toBe(3)
    for (const queries of ['them', 'plugin', 'shell', ['term', 'color'], 'zzz']) {
      expect(index.rank({ queries })).toEqual(rankSearchCandidates(candidates, { queries }))
    }
  })

  test('honours blank-query policy and limits', () => {
    const index = createSearchIndex(candidates)
    expect(index.rank({ queries: ' ', emptyQuery: 'none' })).toEqual([])
    expect(index.rank({ queries: '', limit: 2 }).map((r) => r.item)).toEqual(['theme', 'plugins'])
  })
})
