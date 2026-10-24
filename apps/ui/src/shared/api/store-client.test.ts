/**
 * The Store answers a page at a time (`/rpc/store/listings`, 40 by default, a cursor to the next).
 * Until the Store's screens scroll page by page, the client reads every page of a shelf, so the
 * shelf shows all of it as it did.
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

describe('reading a shelf', () => {
  test('reads every page, following the cursor', async () => {
    const asked: URLSearchParams[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      asked.push(url.searchParams)
      const cursor = url.searchParams.get('cursor')
      const page = cursor ? ['c'] : ['a', 'b']
      return new Response(
        JSON.stringify({
          listings: page.map((id) => makeListing({ id })),
          facets,
          problems: [],
          ...(cursor ? {} : { nextCursor: 'next' }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const answer = await storeApi.listings({ shelf: 'package:mini-app' })
    expect(answer.listings.map((listing) => listing.ref.id)).toEqual(['a', 'b', 'c'])
    expect(answer.nextCursor).toBeUndefined()
    expect(asked.map((params) => params.get('shelf'))).toEqual([
      'package:mini-app',
      'package:mini-app',
    ])
    expect(asked[1]!.get('cursor')).toBe('next')
  })
})
