import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { fetchUrl, stubFetch } from '../../testing/fetch-stub'
import { isForbiddenHost } from './marketplace-download'
import {
  ARCHIVE_TIMEOUT_MS,
  CATALOG_TIMEOUT_MS,
  MAX_ARCHIVE_BYTES,
  MAX_CATALOG_BYTES,
  fetchArchivePlugin,
  fetchCatalogText,
} from './marketplace-source-archive'

/**
 * Claude Code's download limits for hosted files: redirects followed by hand with every hop
 * checked (at most five), a deadline per file kind, and the archive and catalog size ceilings.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dir = tempDirPerTest('mkt-download')

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

describe('archive downloads', () => {
  it('uses 256 MiB / 120 s for archives and 5 MiB / 10 s for catalogs', () => {
    expect(MAX_ARCHIVE_BYTES).toBe(256 * 1024 * 1024)
    expect(ARCHIVE_TIMEOUT_MS).toBe(120_000)
    expect(MAX_CATALOG_BYTES).toBe(5 * 1024 * 1024)
    expect(CATALOG_TIMEOUT_MS).toBe(10_000)
  })

  it('refuses a redirect to plain http or to a loopback / metadata host before requesting it', async () => {
    for (const target of [
      'http://cdn.example/p.zip',
      'https://127.0.0.1/p.zip',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:127.0.0.1]/p.zip',
    ]) {
      const seen = serve({ 'https://a.example/p.zip': () => redirect(target) })
      await expect(
        fetchArchivePlugin({ url: 'https://a.example/p.zip' }, join(dir(), 'out')),
      ).rejects.toThrow('is not https:// on a public host')
      expect(seen).toEqual([{ url: 'https://a.example/p.zip', redirect: 'manual' }])
    }
  })

  it('follows at most five redirects', async () => {
    const hop = (n: number) => `https://a.example/${n}.zip`
    const routes: Record<string, () => Response> = {}
    for (let n = 0; n < 6; n++) routes[hop(n)] = () => redirect(hop(n + 1), 307)
    routes[hop(6)] = () => new Response('not reached')
    const seen = serve(routes)
    await expect(fetchArchivePlugin({ url: hop(0) }, join(dir(), 'out'))).rejects.toThrow(
      'more than 5 redirects',
    )
    expect(seen.map((s) => s.url)).toEqual([0, 1, 2, 3, 4, 5].map(hop))
  })

  it('gives up when the server does not answer within the deadline', async () => {
    globalThis.fetch = stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    await expect(
      fetchArchivePlugin({ url: 'https://a.example/p.zip' }, join(dir(), 'out'), { timeoutMs: 5 }),
    ).rejects.toThrow('timed out after 5 ms')
  })

  it('refuses a declared body past the archive ceiling', async () => {
    serve({
      'https://a.example/p.zip': () =>
        new Response('x', { headers: { 'content-length': String(MAX_ARCHIVE_BYTES + 1) } }),
    })
    await expect(
      fetchArchivePlugin({ url: 'https://a.example/p.zip' }, join(dir(), 'out')),
    ).rejects.toThrow(`exceeds ${MAX_ARCHIVE_BYTES} bytes`)
  })
})

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
    expect(isForbiddenHost('artifacts.example.com')).toBe(false)
  })
})
