import { describe, expect, test } from 'bun:test'
import {
  canonicalizeResearchUrl,
  normalizeResearchDomain,
  rankResearchCandidates,
  selectResearchCandidates,
} from './research-ranking'

describe('research ranking', () => {
  test('canonicalizes URLs and removes tracking without changing meaningful params', () => {
    expect(canonicalizeResearchUrl('https://Example.com/docs?utm_source=x&b=2&a=1#install')).toBe(
      'https://example.com/docs?a=1&b=2',
    )
    expect(canonicalizeResearchUrl('file:///etc/passwd')).toBeNull()
    expect(canonicalizeResearchUrl('https://user:secret@example.com/')).toBeNull()
  })

  test('normalizes domain filters supplied as hosts or URLs', () => {
    expect(normalizeResearchDomain(' Docs.Example.com/path ')).toBe('docs.example.com')
    expect(normalizeResearchDomain('https://example.com/a')).toBe('example.com')
    expect(normalizeResearchDomain('   ')).toBeNull()
  })

  test('deduplicates by canonical URL and rewards cross-query/provider consensus', () => {
    const ranked = rankResearchCandidates({
      observations: [
        {
          query: 'one',
          provider: 'duckduckgo',
          rank: 1,
          hit: {
            title: 'A',
            url: 'https://a.example/doc?utm_source=x',
            snippet: 'short',
            sourceType: 'web',
          },
        },
        {
          query: 'two',
          provider: 'bing',
          rank: 3,
          hit: {
            title: 'Authoritative A',
            url: 'https://a.example/doc',
            snippet: 'the richer snippet',
            sourceType: 'web',
          },
        },
        {
          query: 'one',
          provider: 'duckduckgo',
          rank: 1,
          hit: {
            title: 'B',
            url: 'https://b.example/doc',
            snippet: 'b',
            sourceType: 'web',
          },
        },
      ],
    })

    expect(ranked).toHaveLength(2)
    expect(ranked[0]).toMatchObject({
      url: 'https://a.example/doc',
      title: 'Authoritative A',
      providers: ['duckduckgo', 'bing'],
      queries: ['one', 'two'],
    })
  })

  test('applies include/exclude filters and keeps automatically selected sources diverse', () => {
    const observations = ['a', 'b', 'c'].map((path, index) => ({
      query: 'q',
      provider: 'duckduckgo' as const,
      rank: index + 1,
      hit: {
        title: path,
        url: `https://docs.example.com/${path}`,
        snippet: path,
        sourceType: 'web' as const,
      },
    }))
    observations.push({
      query: 'q',
      provider: 'duckduckgo',
      rank: 4,
      hit: {
        title: 'other',
        url: 'https://other.example/x',
        snippet: 'x',
        sourceType: 'web',
      },
    })
    const ranked = rankResearchCandidates({
      observations,
      excludeDomains: ['blocked.example'],
    })
    expect(selectResearchCandidates(ranked, 4).map((candidate) => candidate.url)).toEqual([
      'https://docs.example.com/a',
      'https://docs.example.com/b',
      'https://other.example/x',
    ])
  })

  test('preserves caller order for explicit URLs', () => {
    const ranked = rankResearchCandidates({
      observations: [],
      suppliedUrls: ['https://z.example/first', 'https://a.example/second'],
    })
    expect(ranked.map((candidate) => candidate.url)).toEqual([
      'https://z.example/first',
      'https://a.example/second',
    ])
  })
})
