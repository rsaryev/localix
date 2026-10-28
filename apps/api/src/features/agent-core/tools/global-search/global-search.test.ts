import { describe, expect, test } from 'bun:test'
import type { SearchRequest, SearchResponse } from '../../../search/contracts'
import { createGlobalSearchTool } from './global-search'
import { GLOBAL_SEARCH_MAX_CHARS } from './global-search-format'

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  groups: [
    {
      domain: 'messages',
      title: 'Messages',
      total: 1,
      hits: [
        {
          id: 'localix://resource/chat/message/s1/m1',
          domain: 'messages',
          title: 'Webhook delivery',
          subtitle: 'user · we configured redelivery',
          snippet: 'we configured [redelivery]',
          score: 0.7,
          matchedBy: 'both',
        },
      ],
    },
    {
      domain: 'files',
      title: 'Files',
      total: 1,
      hits: [
        { id: 'file:///repo/src/retry.ts#L12', domain: 'files', title: 'retry()', score: 0.6 },
      ],
    },
    {
      domain: 'skills',
      title: 'Skills',
      total: 1,
      hits: [
        {
          id: 'localix://resource/catalog/skill/deploy',
          domain: 'skills',
          title: 'deploy',
          score: 0.5,
        },
      ],
    },
  ],
  hits: [],
  total: 3,
  strategy: { mode: 'hybrid' },
  ...over,
})

function tool(answer: (req: SearchRequest) => Promise<SearchResponse>) {
  const requests: SearchRequest[] = []
  const t = createGlobalSearchTool({
    history: {} as never,
    port: {
      search: async (_u, req) => {
        requests.push(req)
        return answer(req)
      },
    },
    userId: 'u1',
    sessionId: 's-current',
    projectId: 'p1',
  })
  const run = async (input: Record<string, unknown>) =>
    (await t.execute('call-1', input as never, undefined as never, undefined as never)) as {
      content: string
      isError?: boolean
      sources?: Array<{ uri: string; role: string }>
    }
  return { run, requests }
}

describe('GlobalSearch', () => {
  test('asks the search service exactly what the palette would, scoped to the session', async () => {
    const { run, requests } = tool(async () => response())
    await run({ query: 'webhook retries' })
    expect(requests[0]).toEqual({
      text: 'webhook retries',
      limit: 5,
      sessionId: 's-current',
      projectId: 'p1',
    })
    await run({ query: 'x', domains: ['messages'], scope: 'everywhere' })
    expect(requests[1]).toMatchObject({ domains: ['messages'], limit: 10, allProjects: true })
  })

  test('every hit carries what the next tool needs to open it', async () => {
    const { run } = tool(async () => response())
    const result = await run({ query: 'retry' })
    const payload = JSON.parse(result.content)
    expect(payload.matching).toBe('words + meaning')
    expect(payload.groups[0].hits[0]).toMatchObject({
      session_id: 's1',
      message_id: 'm1',
      matched_by: 'both',
    })
    expect(payload.groups[1].hits[0]).toMatchObject({ path: '/repo/src/retry.ts', line: 12 })
    expect(payload.groups[2].hits[0].ref).toBe('localix://resource/catalog/skill/deploy')
    expect(result.sources).toEqual([expect.objectContaining({ role: 'discovered' })])
  })

  test('no matches says so, with the strategy and unreachable domains', async () => {
    const { run } = tool(async () =>
      response({
        groups: [],
        total: 0,
        strategy: { mode: 'lexical', reason: 'not-installed' },
        problems: [{ message: 'Docker could not be searched' }],
      }),
    )
    const result = await run({ query: 'nothing' })
    expect(result.content).toBe(
      'No matches for "nothing" (words only). Could not search: Docker could not be searched.',
    )
  })

  test('a huge answer is cut by dropping snippets first, counted, and stays valid JSON', async () => {
    const hits = Array.from({ length: 200 }, (_, i) => ({
      id: `localix://resource/chat/message/s${i}/m${i}`,
      domain: 'messages',
      title: `chat ${i}`.repeat(10),
      snippet: 'x'.repeat(300),
      score: 0.5,
    }))
    const { run } = tool(async () =>
      response({ groups: [{ domain: 'messages', title: 'Messages', total: 200, hits }] }),
    )
    const result = await run({ query: 'x' })
    expect(result.content.length).toBeLessThanOrEqual(GLOBAL_SEARCH_MAX_CHARS)
    const payload = JSON.parse(result.content)
    expect(payload.omitted_hits).toBeGreaterThan(0)
    expect(payload.groups[0].hits[0].snippet).toBeUndefined()
  })

  test('hits in the conversation the agent is in are left out — it already has them', async () => {
    const own = {
      id: 'localix://resource/chat/message/s-current/m9',
      domain: 'messages',
      title: 'this chat',
      score: 0.9,
    }
    const { run } = tool(async () =>
      response({ groups: [{ domain: 'messages', title: 'Messages', total: 1, hits: [own] }] }),
    )
    expect((await run({ query: 'x' })).content).toStartWith('No matches for "x"')
  })

  test('a failing service is a tool error, not a throw', async () => {
    const { run } = tool(async () => {
      throw new Error('db locked')
    })
    expect(await run({ query: 'x' })).toMatchObject({
      isError: true,
      content: 'Search failed: db locked',
    })
  })
})
