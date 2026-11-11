import { afterEach, describe, expect, it } from 'bun:test'
import { fetchUrl, stubFetch } from '../../testing/fetch-stub'
import { isForbiddenHost } from './marketplace-download'
import { fetchCatalogText } from './marketplace-source-archive'

/**
 * Claude Code's download limits for a hosted catalog: redirects followed by hand with every hop
 * checked, its deadline and its size ceiling. An archive's are the kit's (`fetchArchive`).
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Serve `routes` (URL → Response factory); every requested URL and its redirect mode recorded. */
function serve(routes: Record<string, () => Response>): { url: string; redirect?: string }[] {
  const seen: { url: string; redirect?: string }[] = []
  globalThis.fetch = stubFetch(async (input, init) => {
    const url = fetchUrl(input)
    seen.push({ url, redirect: init?.redirect })
    const route = routes[url]
    if (!route) throw new Error(`unexpected fetch ${url}`)
    return route()
  })
  return seen
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } })

describe('hosted catalog downloads', () => {
  it('follows a same-origin redirect, refuses a cross-origin one to http', async () => {
    serve({
      'http://m.example/marketplace.json': () => redirect('/v2/marketplace.json', 301),
      'http://m.example/v2/marketplace.json': () => new Response('{"name":"m"}'),
    })
    expect(await fetchCatalogText('http://m.example/marketplace.json')).toBe('{"name":"m"}')

    const seen = serve({
      'https://m.example/marketplace.json': () => redirect('http://other.example/m.json'),
    })
    await expect(fetchCatalogText('https://m.example/marketplace.json')).rejects.toThrow(
      'is not https:// on a public host',
    )
    expect(seen).toHaveLength(1)
  })

  it('times out on the injected deadline', async () => {
    globalThis.fetch = stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    await expect(
      fetchCatalogText('https://m.example/marketplace.json', { timeoutMs: 5 }),
    ).rejects.toThrow('timed out after 5 ms')
  })
})

describe('isForbiddenHost', () => {
  it('names loopback, link-local and metadata hosts, and lets public ones through', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '169.254.169.254', '[::ffff:7f00:1]'])
      expect(isForbiddenHost(host)).toBe(true)
    expect(isForbiddenHost(new URL('https://2130706433/').hostname)).toBe(true)
    expect(isForbiddenHost('localhost.')).toBe(true)
    expect(isForbiddenHost('127.0.0.1.')).toBe(true)
    expect(isForbiddenHost('artifacts.example.com')).toBe(false)
  })
})
