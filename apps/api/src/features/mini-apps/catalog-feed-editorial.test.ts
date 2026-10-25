import { describe, expect, test } from 'bun:test'

import { readMiniAppCatalogFeed } from './catalog-feed'

const CATALOG = 'https://hosted.test/mini-app-catalog.json'
const app = {
  name: 'chess',
  version: '1.0.0',
  publisher: { name: 'Localix', verified: true },
  archive: { url: 'chess.tar.gz', bytes: 10, sha256: 'a'.repeat(64) },
}
const serve = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

describe('a catalog’s picks for Discover', () => {
  test('come with its apps: collections, items by name or kind and id', async () => {
    const feed = await readMiniAppCatalogFeed(CATALOG, {
      fetchImpl: serve({
        schema: 1,
        apps: [app],
        editorial: {
          collections: [
            { id: 'play', title: 'Play', style: 'grid', items: ['chess', 'plugin:games@localix'] },
          ],
        },
      }),
    })
    expect(feed.apps.map((found) => found.name)).toEqual(['chess'])
    expect(feed.editorial).toEqual({
      collections: [
        { id: 'play', title: 'Play', style: 'grid', items: ['chess', 'plugin:games@localix'] },
      ],
    })
  })

  test('picks that do not read are left out, and the apps still are not', async () => {
    const feed = await readMiniAppCatalogFeed(CATALOG, {
      fetchImpl: serve({ schema: 1, apps: [app], editorial: { collections: 4 } }),
    })
    expect(feed.apps).toHaveLength(1)
    expect(feed.editorial).toEqual({ collections: [] })
  })
})
