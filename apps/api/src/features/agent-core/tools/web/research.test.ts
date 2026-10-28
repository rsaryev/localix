import { describe, expect, test } from 'bun:test'
import { createResearchTool, runResearch } from './research'

function response(body: string, init?: ResponseInit): Response {
  return new Response(body, init)
}

function requestUrl(value: string | URL | Request): string {
  if (typeof value === 'string') return value
  return value instanceof URL ? value.href : value.url
}

const DDG_RESULTS = `
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fprimary%3Futm_source%3Dsearch">Primary docs</a>
  <a class="result__snippet" href="#">Official documentation snippet.</a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fblog.example.org%2Fsecondary">Secondary article</a>
  <a class="result__snippet" href="#">Independent explanation.</a>
`

describe('research tool', () => {
  test('runs search→rank→safe read and emits source-labelled evidence + provenance', async () => {
    const requested: string[] = []
    const fetchImpl = async (value: string | URL | Request) => {
      const url = requestUrl(value)
      requested.push(url)
      if (url.startsWith('https://duckduckgo.com/?')) {
        return response('<html>No VQD in this fixture</html>')
      }
      if (url.startsWith('https://html.duckduckgo.com/')) {
        return response(DDG_RESULTS, {
          headers: { 'content-type': 'text/html' },
        })
      }
      if (url === 'https://docs.example.com/primary') {
        return response(
          '<html><head><title>Primary documentation</title></head><body><article><h1>Primary</h1><p>The authoritative fact is 42 and this paragraph is long enough for readable extraction to retain.</p></article></body></html>',
          { headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === 'https://blog.example.org/secondary') {
        return response('Secondary evidence.', {
          headers: { 'content-type': 'text/plain' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const result = await runResearch(
      {
        question: 'What is the authoritative fact?',
        queries: ['authoritative fact primary docs'],
        max_sources: 2,
      },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: ['duckduckgo'] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('[S1] Primary documentation')
    expect(result.content).toContain('The authoritative fact is 42')
    expect(result.sources).toHaveLength(2)
    expect(result.sources?.[0]).toMatchObject({
      kind: 'web',
      role: 'consulted',
      status: 'available',
      uri: 'https://docs.example.com/primary',
      provider: 'duckduckgo',
    })
    expect(result.details).toMatchObject({
      queries: ['authoritative fact primary docs'],
      providers: ['duckduckgo'],
      candidateCount: 2,
      consultedCount: 2,
      failedCount: 0,
    })
    expect(requested).toHaveLength(4)
  })

  test('aggregates keyless engines and degrades partial failures', async () => {
    const fetchImpl = async (value: string | URL | Request) => {
      const url = requestUrl(value)
      if (url.startsWith('https://duckduckgo.com/?')) {
        return response('<html>No VQD in this fixture</html>')
      }
      if (url.startsWith('https://html.duckduckgo.com/')) {
        return response(DDG_RESULTS)
      }
      if (url.startsWith('https://www.bing.com/search?')) {
        return response('quota', { status: 429 })
      }
      if (url === 'https://docs.example.com/primary') {
        return response('Primary body', {
          headers: { 'content-type': 'text/plain' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const result = await runResearch(
      { question: 'question', max_sources: 1 },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: ['duckduckgo', 'bing'] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.details?.providers).toEqual(['duckduckgo', 'bing'])
    expect(result.details?.searches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'duckduckgo', resultCount: 2 }),
        expect.objectContaining({
          provider: 'bing',
          resultCount: 0,
          error: 'HTTP 429',
        }),
      ]),
    )
  })

  test('decodes Bing redirect targets before domain filtering and reading', async () => {
    const encoded = `a1${Buffer.from('https://bun.sh/').toString('base64url')}`
    const redirect = `https://www.bing.com/ck/a?u=${encoded}`
    const fetchImpl = async (value: string | URL | Request) => {
      const url = requestUrl(value)
      if (url.startsWith('https://www.bing.com/search?')) {
        return response(
          `<ol><li class="b_algo"><h2><a href="${redirect}">Bun runtime</a></h2><p>Official runtime.</p></li></ol>`,
          { headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === 'https://bun.sh/') {
        return response('Bun is a JavaScript runtime.', {
          headers: { 'content-type': 'text/plain' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const result = await runResearch(
      {
        question: 'What is Bun?',
        queries: ['Bun JavaScript runtime'],
        include_domains: ['bun.sh'],
        max_sources: 1,
      },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: ['bing'] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.sources?.[0]).toMatchObject({
      uri: 'https://bun.sh/',
      provider: 'bing',
      role: 'consulted',
    })
  })

  test('parses Brave organic results through the provider-neutral contract', async () => {
    const requested: string[] = []
    const fetchImpl = async (value: string | URL | Request) => {
      const url = requestUrl(value)
      requested.push(url)
      if (url.startsWith('https://search.brave.com/search?')) {
        return response(
          `<main>
            <div class="snippet" data-type="web">
              <a href="https://bun.sh/?utm_source=search">
                <div class="site-name">Bun</div>
                <div class="title search-snippet-title">Bun JavaScript runtime</div>
              </a>
              <div class="content">The fast all-in-one JavaScript runtime.</div>
            </div>
          </main>`,
          { headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === 'https://bun.sh/') {
        return response('Bun is a JavaScript runtime.', {
          headers: { 'content-type': 'text/plain' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const result = await runResearch(
      {
        question: 'What is Bun?',
        queries: ['Bun JavaScript runtime'],
        include_domains: ['bun.sh'],
        recency_days: 7,
        max_sources: 1,
      },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: ['brave'] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(requested[0]).toContain('tf=pw')
    expect(result.sources?.[0]).toMatchObject({
      uri: 'https://bun.sh/',
      title: 'Bun JavaScript runtime',
      provider: 'brave',
      role: 'consulted',
    })
    expect(result.details?.searches).toEqual([
      expect.objectContaining({
        provider: 'brave',
        strategy: 'html',
        resultCount: 1,
      }),
    ])
  })

  test('routes provider-neutral academic discovery and cites the canonical DOI', async () => {
    const requested: string[] = []
    const fetchImpl = async (value: string | URL | Request) => {
      const url = requestUrl(value)
      requested.push(url)
      if (url.startsWith('https://api.crossref.org/works?')) {
        return response(
          JSON.stringify({
            message: {
              items: [
                {
                  DOI: '10.1234/example',
                  title: ['Evidence paper'],
                  abstract: '<jats:p>Measured evidence from the paper.</jats:p>',
                  published: { 'date-parts': [[2026, 7, 1]] },
                  URL: 'https://doi.org/10.1234/example',
                },
              ],
            },
          }),
        )
      }
      if (url === 'https://api.crossref.org/works/10.1234%2Fexample') {
        return response('{"abstract":"Measured evidence from the paper."}', {
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const result = await runResearch(
      {
        question: 'What does the paper report?',
        queries: ['measured evidence'],
        source_types: ['academic'],
        max_sources: 1,
      },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: ['duckduckgo', 'crossref'] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.details?.providers).toEqual(['crossref'])
    expect(result.details?.sourceTypes).toEqual(['academic'])
    expect(result.sources?.[0]).toMatchObject({
      uri: 'https://doi.org/10.1234/example',
      role: 'consulted',
      provider: 'crossref',
    })
    expect(result.content).toContain('URL: https://doi.org/10.1234/example')
    expect(requested).toHaveLength(2)
  })

  test('honors provider backoff by skipping its remaining query variants', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls++
      return response('limited', {
        status: 429,
        headers: { 'retry-after': '60' },
      })
    }

    const result = await runResearch(
      {
        question: 'question',
        queries: ['first query', 'second query'],
      },
      { fetchImpl, config: { backends: ['bing'] } },
    )

    expect(result.isError).toBe(true)
    expect(calls).toBe(1)
    expect(result.details?.searches).toEqual([
      expect.objectContaining({
        query: 'first query',
        provider: 'bing',
        error: 'HTTP 429',
      }),
      expect.objectContaining({
        query: 'second query',
        provider: 'bing',
        skipped: true,
      }),
    ])
  })

  test('reads supplied URLs without issuing a search when queries are omitted', async () => {
    let calls = 0
    const fetchImpl = async (value: string | URL | Request) => {
      calls++
      expect(requestUrl(value)).toBe('https://example.com/source')
      return response('Direct primary source', {
        headers: { 'content-type': 'text/plain' },
      })
    }

    const result = await runResearch(
      {
        question: 'Summarize the supplied source',
        urls: ['https://example.com/source'],
      },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: ['duckduckgo'] },
      },
    )

    expect(calls).toBe(1)
    expect(result.details?.queries).toEqual([])
    expect(result.sources?.[0].provider).toBe('direct')
  })

  test('backfills a failed top candidate without exceeding max_sources', async () => {
    let fetches = 0
    const result = await runResearch(
      {
        question: 'Read the first available source',
        urls: ['http://127.0.0.1/private', 'https://example.com/public'],
        max_sources: 1,
      },
      {
        fetchImpl: async () => {
          fetches++
          return response('Public evidence', {
            headers: { 'content-type': 'text/plain' },
          })
        },
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: [] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(fetches).toBe(1)
    expect(result.details).toMatchObject({ consultedCount: 1, failedCount: 1 })
    expect(result.sources).toEqual([
      expect.objectContaining({
        uri: 'http://127.0.0.1/private',
        role: 'discovered',
        status: 'failed',
      }),
      expect.objectContaining({
        uri: 'https://example.com/public',
        role: 'consulted',
        status: 'available',
      }),
    ])
  })

  test('skips a PDF source and reads the next text source', async () => {
    const result = await runResearch(
      {
        question: 'Read the available source',
        urls: ['https://example.com/unrelated.pdf', 'https://example.com/relevant'],
        max_sources: 1,
      },
      {
        fetchImpl: async (value) =>
          requestUrl(value).endsWith('.pdf')
            ? response('%PDF-1.4\n1 0 obj\n<</Title (Unrelated)>>', {
                headers: { 'content-type': 'application/pdf' },
              })
            : response('Relevant text evidence', {
                headers: { 'content-type': 'text/plain' },
              }),
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: [] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Relevant text evidence')
    expect(result.content).not.toContain('%PDF-')
    expect(result.details).toMatchObject({ consultedCount: 1, failedCount: 1 })
    expect(result.sources).toEqual([
      expect.objectContaining({ status: 'failed', uri: 'https://example.com/unrelated.pdf' }),
      expect.objectContaining({ status: 'available', uri: 'https://example.com/relevant' }),
    ])
  })

  test('serializes reads to the same host', async () => {
    let active = 0
    let maxActive = 0
    const fetchImpl = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active--
      return response('Evidence', {
        headers: { 'content-type': 'text/plain' },
      })
    }

    const result = await runResearch(
      {
        question: 'Read both sources',
        urls: ['https://example.com/one', 'https://example.com/two'],
        max_sources: 2,
      },
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
        config: { backends: [] },
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.details?.consultedCount).toBe(2)
    expect(maxActive).toBe(1)
  })

  test('keeps failed reads visible but never calls them consulted', async () => {
    const result = await runResearch(
      { question: 'Read it', urls: ['http://127.0.0.1/secret'] },
      { config: { backends: ['duckduckgo'] } },
    )

    expect(result.isError).toBe(true)
    expect(result.sources).toEqual([
      expect.objectContaining({
        uri: 'http://127.0.0.1/secret',
        role: 'discovered',
        status: 'failed',
      }),
    ])
    expect(result.details?.consultedCount).toBe(0)
  })

  test('rejects contradictory domain filters without touching the network', async () => {
    const contradictory = await runResearch(
      {
        question: 'x',
        include_domains: ['example.com'],
        exclude_domains: ['https://example.com/path'],
      },
      { config: { backends: ['duckduckgo'] } },
    )
    expect(contradictory.isError).toBe(true)
    expect(contradictory.content).toContain('both included and excluded')
  })

  test('exposes one composite public tool', () => {
    const tool = createResearchTool()
    expect(tool.name).toBe('Research')
    expect(tool.executionMode).toBe('parallel')
    expect(tool.contextClass).toBe('readResult')
  })
})
