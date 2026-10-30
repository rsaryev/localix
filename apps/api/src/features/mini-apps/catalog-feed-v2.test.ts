import { describe, expect, test } from 'bun:test'

import { readMiniAppCatalogFeed } from './catalog-feed'

// Schema 2 is a marketplace in the shape of Claude Code's: who owns it, Localix's picks under
// `metadata.localix`, and each app's `source` — built beside it, or another catalog.

const sha = 'b'.repeat(64)
const serve = (body: unknown) =>
  (async (input: string | URL | Request) =>
    String(input).endsWith('.sig')
      ? new Response('missing', { status: 404 })
      : new Response(JSON.stringify(body))) as unknown as typeof fetch

const marketplace = {
  schema: 2,
  name: 'localix',
  owner: { name: 'Localix' },
  metadata: {
    description: 'Localix’s own mini apps',
    localix: {
      featured: ['kanban'],
      recommended: ['kanban'],
      suits: { kanban: { files: ['TODO.md'] } },
      collections: [{ id: 'work', title: 'Work', items: ['kanban', 'plugin:team@localix'] }],
    },
  },
  apps: [
    {
      name: 'kanban',
      displayName: 'Kanban',
      description: 'A board per chat',
      version: '1.2.0',
      apiVersion: 2,
      author: { name: 'Localix' },
      source: { source: 'archive', url: 'kanban-1.2.0.tar.gz', bytes: 10, sha256: sha },
    },
    {
      name: 'chess',
      description: 'Chess',
      source: { source: 'archive', url: 'c.tar.gz', bytes: 1, sha256: sha },
    },
    {
      name: 'habits',
      description: 'Track habits',
      source: { source: 'github', repo: 'ada/habits' },
    },
    {
      name: 'notes',
      description: 'Notes',
      category: 'utilities',
      homepage: 'https://notes.example.test',
      source: { source: 'url', url: 'https://notes.example.test/mini-app-catalog.json' },
    },
    { name: 'plain', source: { source: 'url', url: 'http://plain.example.test/c.json' } },
    { name: 'odd', source: { source: 'git-subdir', url: 'x/y', path: 'a' } },
  ],
}

describe('a schema 2 catalog', () => {
  test('reads a built app as Localix installs it, published by the catalog’s owner', async () => {
    const feed = await readMiniAppCatalogFeed('https://example.test/c/mini-app-catalog.json', {
      fetchImpl: serve(marketplace),
    })
    expect(feed.apps).toEqual([
      {
        name: 'kanban',
        displayName: 'Kanban',
        description: 'A board per chat',
        version: '1.2.0',
        apiVersion: 2,
        author: 'Localix',
        publisher: { name: 'Localix', verified: true },
        archive: { url: 'https://example.test/c/kanban-1.2.0.tar.gz', bytes: 10, sha256: sha },
        featured: true,
        recommended: true,
        suits: { files: ['TODO.md'] },
      },
    ])
    // A built app needs its version; one without is not an app Localix can install.
    expect(feed.apps.map((app) => app.name)).not.toContain('chess')
    expect(feed.editorial?.collections).toEqual([
      { id: 'work', title: 'Work', style: 'row', items: ['kanban', 'plugin:team@localix'] },
    ])
  })

  test('links an app to its own catalog: a repository’s release, or an HTTPS address', async () => {
    const feed = await readMiniAppCatalogFeed('https://example.test/c/marketplace.json', {
      fetchImpl: serve(marketplace),
    })
    expect(feed.links).toEqual([
      {
        name: 'habits',
        url: 'https://github.com/ada/habits/releases/latest/download/mini-app-catalog.json',
        description: 'Track habits',
      },
      {
        name: 'notes',
        url: 'https://notes.example.test/mini-app-catalog.json',
        description: 'Notes',
        category: 'utilities',
        homepage: 'https://notes.example.test',
      },
    ])
  })

  test('schema 1 is still read, and anything else is not a catalog', async () => {
    const one = await readMiniAppCatalogFeed('https://example.test/c.json', {
      fetchImpl: serve({ schema: 1, apps: [] }),
    })
    expect(one).toMatchObject({ apps: [], links: [] })
    await expect(
      readMiniAppCatalogFeed('https://example.test/c.json', {
        fetchImpl: serve({ schema: 3, apps: [] }),
      }),
    ).rejects.toThrow('is not a mini app catalog')
  })
})
