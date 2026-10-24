/**
 * The Store answers a page at a time (`/rpc/store/listings`, 40 by default, a cursor to the next):
 * the client reads one page per call and the screens ask for the next as they scroll. Writes
 * name the open project, so a project install goes to it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import { storeApi } from './store-client'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const facets = {
  shelves: {},
  kind: {},
  component: {},
  category: {},
  source: {},
  installed: 0,
  updates: 0,
}

/** Answer every request with `body`, recording what was asked. */
function serve(body: unknown, status = 200) {
  const asked: Array<{ url: URL; method: string; body: unknown }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const text = await request.text()
    asked.push({
      url: new URL(request.url),
      method: request.method,
      body: text ? JSON.parse(text) : undefined,
    })
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
  }) as typeof fetch
  return asked
}

describe('the Store client', () => {
  test('reads one page, with its filters, the project and where to start', async () => {
    const asked = serve({
      listings: [makeListing({ id: 'a' })],
      facets,
      problems: [],
      nextCursor: 'next',
    })
    const answer = await storeApi.page({
      shelf: 'package:plugin',
      category: 'Data',
      trust: 'official',
      projectId: 'p1',
      cursor: 'c1',
    })
    expect(answer.nextCursor).toBe('next')
    expect(asked).toHaveLength(1)
    const params = asked[0]!.url.searchParams
    expect(params.get('shelf')).toBe('package:plugin')
    expect(params.get('category')).toBe('Data')
    expect(params.get('trust')).toBe('official')
    expect(params.get('projectId')).toBe('p1')
    expect(params.get('cursor')).toBe('c1')
  })

  test('sources come with the kinds a source can be added for', async () => {
    serve({ sources: [], addable: ['plugin'] })
    expect(await storeApi.sources()).toEqual({ sources: [], addable: ['plugin'] })
  })

  test('a page and a write name the open project', async () => {
    const asked = serve({}, 204)
    await storeApi.install({ kind: 'plugin', id: 'x' }, 'project', { plan: true }, 'p1')
    expect(asked[0]!.body).toEqual({ scope: 'project', consent: { plan: true }, projectId: 'p1' })
    await storeApi.refreshSource('plugin', 'acme')
    await storeApi.setSourceAutoUpdate('plugin', 'acme', false)
    expect(asked.slice(1).map((call) => [call.url.pathname, call.body])).toEqual([
      ['/rpc/store/sources/refresh', { kind: 'plugin', id: 'acme' }],
      ['/rpc/store/sources/auto-update', { kind: 'plugin', id: 'acme', autoUpdate: false }],
    ])
  })

  test('a listing’s page asks for the open project’s install', async () => {
    const asked = serve({})
    await storeApi.detail({ kind: 'plugin', id: 'x' }, 'p1').catch(() => {})
    expect(asked[0]!.url.searchParams.get('projectId')).toBe('p1')
  })
})
