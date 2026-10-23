import { describe, expect, test } from 'bun:test'

import { readMiniAppCatalog } from './catalog-feed'

const sha = 'a'.repeat(64)
const catalog = {
  schema: 1,
  apps: [
    {
      name: 'chess',
      displayName: 'Chess',
      description: 'Play chess',
      category: 'games',
      version: '1.0.0',
      apiVersion: 1,
      publisher: { name: 'Localix', verified: true },
      archive: { url: 'chess-1.0.0.tar.gz', bytes: 120, sha256: sha },
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
          url: 'https://example.test/mini-apps/chess-1.0.0.tar.gz',
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
    expect(apps.map((app) => app.name)).toEqual(['chess'])
  })

  test('reads the store fields beside it, media resolved against the catalog; a bad one is dropped alone', async () => {
    const media = (url: string, type?: string) => ({
      url,
      bytes: 10,
      sha256: sha,
      ...(type ? { type } : {}),
    })
    const [chess] = await readMiniAppCatalog('https://example.test/mini-apps/catalog.json', {
      fetchImpl: serve({
        schema: 1,
        apps: [
          {
            ...catalog.apps[0]!,
            icon: media('chess-icon.svg', 'image/svg+xml'),
            screenshots: [
              { ...media('chess-1.png', 'image/png'), caption: 'A position' },
              media('http://elsewhere.test/2.png', 'image/png'),
              { url: 'broken.png' },
            ],
            readme: media('chess-readme.md'),
            tags: ['game', 'Not A Tag', 'board-game'],
            homepage: 'https://example.test/chess',
            license: 'MIT',
            author: 'Ada',
            featured: true,
            surfaces: ['agent', 'workbench'],
            commands: ['new'],
          },
        ],
      }),
    })
    expect(chess).toMatchObject({
      icon: { url: 'https://example.test/mini-apps/chess-icon.svg', type: 'image/svg+xml' },
      screenshots: [{ url: 'https://example.test/mini-apps/chess-1.png', caption: 'A position' }],
      readme: { url: 'https://example.test/mini-apps/chess-readme.md', bytes: 10 },
      tags: ['game', 'board-game'],
      homepage: 'https://example.test/chess',
      license: 'MIT',
      author: 'Ada',
      featured: true,
      surfaces: ['agent', 'workbench'],
      commands: ['new'],
    })
    expect(chess!.screenshots).toHaveLength(1)

    const [plain] = await readMiniAppCatalog('https://example.test/catalog.json', {
      fetchImpl: serve({ schema: 1, apps: [{ ...catalog.apps[0]!, icon: 'icon.svg', tags: 3 }] }),
    })
    expect(plain!.name).toBe('chess')
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
