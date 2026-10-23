import { describe, expect, test } from 'bun:test'
import type { SemanticMatch, SemanticQuery } from '@localixai/mini-app-sdk/backend'
import type { SearchQuery } from '../agent-core/search/provider'
import { catalogHits } from './catalog-hybrid'

const rows = [
  { name: 'review', description: 'Review a pull request and comment on risky changes' },
  { name: 'deploy', description: 'Ship the build to production' },
]

function semantic(matches: Partial<SemanticMatch>[], seen: unknown[] = []): SemanticQuery {
  return {
    zGate: 2,
    async similar(collection, options) {
      seen.push({ collection, options })
      return matches.map((m) => ({
        key: '',
        chunk: 0,
        excerpt: '',
        z: 0,
        gate: 2,
        cosine: 0,
        scope: null,
        ...m,
      }))
    },
  }
}

const search = (query: Partial<SearchQuery>) =>
  catalogHits({ text: '', ...query } as SearchQuery, {
    collection: 'capabilities.skills',
    rows,
    nameOf: (row) => row.name,
    fields: (row) => [row.name, row.description],
    hit: (row, score) => ({
      id: row.name,
      domain: 'skills',
      title: row.name,
      icon: 'skill',
      score,
    }),
  })

describe('catalog search', () => {
  test('words alone when semantic search does not answer', async () => {
    expect((await search({ text: 'deploy' })).map((h) => h.id)).toEqual(['deploy'])
  })

  test('meaning finds what shares no word, in its own collection and the project with global', async () => {
    const seen: unknown[] = []
    const hits = await search({
      text: 'look over my code',
      projectId: 'p1',
      semantic: semantic([{ key: 'global:review', z: 4 }], seen),
    })
    expect(hits.map((h) => [h.id, h.matchedBy])).toEqual([['review', 'meaning']])
    expect(seen).toEqual([
      { collection: 'capabilities.skills', options: { limit: 50, scope: ['global', 'p1'] } },
    ])
  })

  test('a match that does not stand out from its collection is not a hit', async () => {
    const hits = await search({
      text: 'weather',
      semantic: semantic([{ key: 'global:deploy', z: 1 }]),
    })
    expect(hits).toEqual([])
  })
})
