import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import { readMiniAppCatalog, readMiniAppCatalogFeed } from './catalog-feed'
import { signCatalog } from './catalog-signature'

const sha = 'a'.repeat(64)
const catalog = {
  schema: 1,
  apps: [
    {
      name: 'atlas',
      displayName: 'Atlas',
      description: 'Play atlas',
      category: 'games',
      version: '1.0.0',
      apiVersion: 1,
      publisher: { name: 'Localix', verified: true },
      archive: { url: 'atlas-1.0.0.tar.gz', bytes: 120, sha256: sha },
    },
  ],
}

const serve = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('a mini app catalog', () => {
  test('lists its apps, each archive resolved against the catalog it came from', async () => {
    const apps = await readMiniAppCatalog('https://example.test/mini-apps/catalog.json', {
      fetchImpl: serve(catalog),
    })
    expect(apps).toEqual([
      {
        ...catalog.apps[0]!,
        archive: {
          ...catalog.apps[0]!.archive,
          url: 'https://example.test/mini-apps/atlas-1.0.0.tar.gz',
        },
      },
    ])
  })

  test('an app with a bad name or checksum is left out; the rest stay', async () => {
    const apps = await readMiniAppCatalog('https://example.test/catalog.json', {
      fetchImpl: serve({
        schema: 1,
        apps: [
          ...catalog.apps,
          { ...catalog.apps[0]!, name: '../evil' },
          {
            ...catalog.apps[0]!,
            name: 'notes',
            archive: { url: 'n.tar.gz', bytes: 1, sha256: 'x' },
          },
        ],
      }),
    })
    expect(apps.map((app) => app.name)).toEqual(['atlas'])
  })

  test('reads the store fields beside it, media resolved against the catalog; a bad one is dropped alone', async () => {
    const media = (url: string, type?: string) => ({
      url,
      bytes: 10,
      sha256: sha,
      ...(type ? { type } : {}),
    })
    const [atlas] = await readMiniAppCatalog('https://example.test/mini-apps/catalog.json', {
      fetchImpl: serve({
        schema: 1,
        apps: [
          {
            ...catalog.apps[0]!,
            icon: media('atlas-icon.svg', 'image/svg+xml'),
            screenshots: [
              { ...media('atlas-1.png', 'image/png'), caption: 'A position' },
              media('http://elsewhere.test/2.png', 'image/png'),
              { url: 'broken.png' },
            ],
            readme: media('atlas-readme.md'),
            tags: ['game', 'Not A Tag', 'board-game'],
            homepage: 'https://example.test/atlas',
            license: 'MIT',
            author: 'Ada',
            featured: true,
            surfaces: ['agent', 'workbench'],
            commands: ['new'],
          },
        ],
      }),
    })
    expect(atlas).toMatchObject({
      icon: { url: 'https://example.test/mini-apps/atlas-icon.svg', type: 'image/svg+xml' },
      screenshots: [{ url: 'https://example.test/mini-apps/atlas-1.png', caption: 'A position' }],
      readme: { url: 'https://example.test/mini-apps/atlas-readme.md', bytes: 10 },
      tags: ['game', 'board-game'],
      homepage: 'https://example.test/atlas',
      license: 'MIT',
      author: 'Ada',
      featured: true,
      surfaces: ['agent', 'workbench'],
      commands: ['new'],
    })
    expect(atlas!.screenshots).toHaveLength(1)

    const [plain] = await readMiniAppCatalog('https://example.test/catalog.json', {
      fetchImpl: serve({ schema: 1, apps: [{ ...catalog.apps[0]!, icon: 'icon.svg', tags: 3 }] }),
    })
    expect(plain!.name).toBe('atlas')
    expect(plain!.icon).toBeUndefined()
    expect(plain!.tags).toBeUndefined()
  })

  test('a catalog that cannot be read says where and why', async () => {
    await expect(
      readMiniAppCatalog('https://example.test/catalog.json', { fetchImpl: serve({}, 503) }),
    ).rejects.toThrow(/example\.test.*503/)
    await expect(
      readMiniAppCatalog('https://example.test/catalog.json', { fetchImpl: serve({ schema: 9 }) }),
    ).rejects.toThrow(/catalog/)
  })
})

describe('a catalog with its signature', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const text = JSON.stringify(catalog)
  const served = (signature: string) =>
    (async (url: string | URL) =>
      String(url).endsWith('.sig')
        ? new Response(signature)
        : new Response(text)) as unknown as typeof fetch

  test('is read with the signature of the exact bytes it was served as', async () => {
    const signature = signCatalog(new TextEncoder().encode(text), privateKey)
    const feed = await readMiniAppCatalogFeed('https://example.test/catalog.json', {
      fetchImpl: served(signature),
    })
    expect(feed.signature).toEqual({ state: 'signed', key: JSON.parse(signature).key })
  })

  // Re-serialised JSON is not what was signed: a space moved is another catalog.
  test('a signature of other bytes of the same JSON does not hold', async () => {
    const pretty = new TextEncoder().encode(JSON.stringify(catalog, null, 2))
    const feed = await readMiniAppCatalogFeed('https://example.test/catalog.json', {
      fetchImpl: served(signCatalog(pretty, privateKey)),
    })
    expect(feed.signature.state).toBe('invalid')
  })
})
