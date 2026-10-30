import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

import { publicKeyOf, signMarketplace } from '@localixai/mini-app-sdk/marketplace-signature'
import { tempDirPerTest } from '@localixai/testing'

import { readMarketplaceFeed } from './marketplace-feed'

const sha = 'a'.repeat(64)
const marketplace = {
  schema: 3,
  name: 'ada',
  owner: { name: 'Ada' },
  published: '2026-10-30T12:00:00.000Z',
  apps: [
    {
      name: 'atlas',
      displayName: 'Atlas',
      description: 'Play atlas',
      version: '1.0.0',
      source: { source: 'archive', url: 'atlas-1.0.0.tar.gz', bytes: 120, sha256: sha },
      icon: { url: 'atlas-icon.svg', bytes: 10, sha256: sha, type: 'image/svg+xml' },
      screenshots: [
        { url: 'atlas-1.png', bytes: 10, sha256: sha, type: 'image/png', caption: 'A position' },
        { url: 'http://elsewhere.test/2.png', bytes: 10, sha256: sha, type: 'image/png' },
      ],
      readme: { url: 'atlas-readme.md', bytes: 10, sha256: sha },
    },
    {
      name: 'habits',
      description: 'Track habits with the agent.',
      source: { source: 'github', repo: 'grace/habits' },
    },
    { name: 'timer', source: { source: 'url', url: 'https://grace.example/m.json' } },
  ],
}

const serve = (body: unknown, status = 200) =>
  (async (url: string | URL) =>
    String(url).endsWith('.sig')
      ? new Response('missing', { status: 404 })
      : new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

const AT = 'https://example.test/mini-apps/mini-app-marketplace.json'

describe('a released marketplace read over the network', () => {
  test('its archives and media are addressed against the marketplace; plain http is not fetched', async () => {
    const feed = await readMarketplaceFeed(AT, { fetchImpl: serve(marketplace) })
    expect(feed.marketplace.apps[0]).toMatchObject({
      source: { source: 'archive', url: 'https://example.test/mini-apps/atlas-1.0.0.tar.gz' },
      icon: { url: 'https://example.test/mini-apps/atlas-icon.svg' },
      screenshots: [{ url: 'https://example.test/mini-apps/atlas-1.png', caption: 'A position' }],
      readme: { url: 'https://example.test/mini-apps/atlas-readme.md' },
    })
    expect(feed.marketplace.apps[0]!.screenshots).toHaveLength(1)
  })

  test('a linked app points at the marketplace it lives in', async () => {
    const feed = await readMarketplaceFeed(AT, { fetchImpl: serve(marketplace) })
    expect(feed.links).toEqual([
      {
        name: 'habits',
        url: 'https://github.com/grace/habits/releases/latest/download/mini-app-marketplace.json',
        description: 'Track habits with the agent.',
      },
      { name: 'timer', url: 'https://grace.example/m.json' },
    ])
    expect(feed.marketplace.apps.map((app) => app.name)).toEqual(['atlas', 'habits', 'timer'])
  })

  test('without a signature file beside it, it carries no signatures', async () => {
    const feed = await readMarketplaceFeed(AT, { fetchImpl: serve(marketplace) })
    expect(feed.signatures).toBeNull()
  })

  test('one that cannot be read says where and why', async () => {
    await expect(readMarketplaceFeed(AT, { fetchImpl: serve({}, 503) })).rejects.toThrow(
      /example\.test.*503/,
    )
    await expect(
      readMarketplaceFeed(AT, { fetchImpl: serve({ schema: 2, apps: [] }) }),
    ).rejects.toThrow(/not a schema 3 mini app marketplace/)
    await expect(
      readMarketplaceFeed(AT, {
        fetchImpl: (async () => new Response('<html>')) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not JSON/)
  })

  test('one of a newer format asks for a newer Localix', async () => {
    await expect(
      readMarketplaceFeed(AT, { fetchImpl: serve({ ...marketplace, schema: 4 }) }),
    ).rejects.toThrow(/schema 4.*update Localix/)
  })
})

describe('a marketplace with its signatures', () => {
  const key = generateKeyPairSync('ed25519').privateKey
  const text = JSON.stringify(marketplace)
  const served = (signature: string) =>
    (async (url: string | URL) =>
      String(url).endsWith('.sig')
        ? new Response(signature)
        : new Response(text)) as unknown as typeof fetch

  test('is read with the signatures of the exact bytes it was served as', async () => {
    const feed = await readMarketplaceFeed(AT, {
      fetchImpl: served(signMarketplace(new TextEncoder().encode(text), [key])),
    })
    expect(feed.signatures).toEqual({ keys: [publicKeyOf(key)] })
  })

  // Re-serialised JSON is not what was signed: a space moved is another marketplace.
  test('a signature of other bytes of the same JSON does not hold', async () => {
    const pretty = new TextEncoder().encode(JSON.stringify(marketplace, null, 2))
    const feed = await readMarketplaceFeed(AT, {
      fetchImpl: served(signMarketplace(pretty, [key])),
    })
    expect(feed.signatures).toEqual({ keys: [] })
  })

  test('a signature file that cannot be fetched fails the read: it says nothing either way', async () => {
    const fetchImpl = (async (url: string | URL) =>
      String(url).endsWith('.sig')
        ? new Response('busy', { status: 500 })
        : new Response(text)) as unknown as typeof fetch
    await expect(readMarketplaceFeed(AT, { fetchImpl })).rejects.toThrow(/signature.*500/)
  })
})

describe('a marketplace in a folder on this computer', () => {
  const dir = tempDirPerTest('marketplace-feed-')

  test('its files and links beside it are read from the folder; its signature too', async () => {
    const key = generateKeyPairSync('ed25519').privateKey
    const local = {
      ...marketplace,
      apps: [
        marketplace.apps[0],
        { name: 'beside', source: { source: 'url', url: 'other/mini-app-marketplace.json' } },
      ],
    }
    const text = JSON.stringify(local)
    const file = join(dir(), 'mini-app-marketplace.json')
    writeFileSync(file, text)
    writeFileSync(`${file}.sig`, signMarketplace(new TextEncoder().encode(text), [key]))
    const url = pathToFileURL(file).href
    const feed = await readMarketplaceFeed(url)
    expect(feed.marketplace.apps[0]!.source).toMatchObject({
      url: pathToFileURL(join(dir(), 'atlas-1.0.0.tar.gz')).href,
    })
    expect(feed.links).toEqual([
      { name: 'beside', url: pathToFileURL(join(dir(), 'other/mini-app-marketplace.json')).href },
    ])
    expect(feed.signatures).toEqual({ keys: [publicKeyOf(key)] })
  })
})

// GitHub serves `releases/latest/download/<file>` through two redirects: to the release's own
// address, then to a storage address whose query names the file (the storage ignores it). The
// signature is the release's, read beside its own address: not beside the storage's, which would
// serve the marketplace again, nor beside `latest`, which may by then be a newer release.
describe('a marketplace published as a GitHub release', () => {
  const key = generateKeyPairSync('ed25519').privateKey
  const text = JSON.stringify(marketplace)
  const file = 'mini-app-marketplace.json'
  const latest = `https://github.test/o/r/releases/latest/download/${file}`
  const release = `https://github.test/o/r/releases/download/v2/${file}`
  const stored = (blob: string, name: string) =>
    `https://assets.test/${blob}?sig=x&rscd=attachment%3B+filename%3D${name}`
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })
  const routes: Record<string, () => Response> = {
    [latest]: () => redirect(release),
    [`${latest}.sig`]: () => redirect(`https://github.test/o/r/releases/download/v3/${file}.sig`),
    [`https://github.test/o/r/releases/download/v3/${file}.sig`]: () =>
      new Response(signMarketplace(new TextEncoder().encode('{"newer":true}'), [key])),
    [release]: () => redirect(stored('marketplace', file)),
    [`${release}.sig`]: () => redirect(stored('signature', `${file}.sig`)),
    'https://assets.test/marketplace': () => new Response(text),
    'https://assets.test/signature': () =>
      new Response(signMarketplace(new TextEncoder().encode(text), [key])),
  }
  const github = (async (input: string | URL, init?: RequestInit) => {
    let at = String(input)
    for (;;) {
      const plain = new URL(at)
      const route = routes[at] ?? routes[`${plain.origin}${plain.pathname}`]
      const response = route ? route() : new Response('missing', { status: 404 })
      const to = response.headers.get('location')
      if (!to || init?.redirect === 'manual') {
        Object.defineProperty(response, 'url', { value: at })
        return response
      }
      at = new URL(to, at).href
    }
  }) as unknown as typeof fetch

  test('is signed by the signatures its release published', async () => {
    const feed = await readMarketplaceFeed(latest, { fetchImpl: github })
    expect(feed.signatures).toEqual({ keys: [publicKeyOf(key)] })
  })
})
