import { describe, expect, test } from 'bun:test'

import { previewMiniAppCatalog } from './catalog-preview'

const URL_ = 'https://ada.example.test/releases/latest/download/mini-app-catalog.json'
const sha = 'a'.repeat(64)
const app = (name: string, publisher: string, icon = true) => ({
  name,
  displayName: name.toUpperCase(),
  description: `${name} app`,
  version: '1.0.0',
  publisher: { name: publisher, verified: true },
  ...(icon ? { icon: { url: `${name}.svg`, bytes: 10, sha256: sha, type: 'image/svg+xml' } } : {}),
  archive: { url: `${name}.tar.gz`, bytes: 10, sha256: sha },
})
const serving = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

const image = async () => ({ bytes: new TextEncoder().encode('<svg/>'), type: 'image/svg+xml' })

describe('previewing a catalog before it is added', () => {
  test('says who publishes it, how many apps, the first icons, and that it is unverified', async () => {
    const preview = await previewMiniAppCatalog(` ${URL_} `, {
      fetchImpl: serving({
        schema: 1,
        apps: [app('notes', 'Ada'), app('timer', 'Ada'), app('radio', 'Bob', false)],
      }),
      catalogImage: image,
      added: async () => [],
    })
    expect(preview).toMatchObject({
      url: URL_,
      publishers: ['Ada', 'Bob'],
      apps: 3,
      verified: false,
      added: false,
    })
    expect(preview.icons.map(({ name }) => name)).toEqual(['notes', 'timer'])
    expect(preview.icons[0]!.src).toStartWith('data:image/svg+xml;base64,')
  })

  test('an address that is not a catalog is refused with the reason, before anything is kept', async () => {
    const deps = { catalogImage: image, added: async () => [] }
    await expect(
      previewMiniAppCatalog('http://ada.example.test/c.json', { ...deps, fetchImpl: serving({}) }),
    ).rejects.toThrow(/HTTPS/)
    await expect(
      previewMiniAppCatalog(URL_, { ...deps, fetchImpl: serving({}, 404) }),
    ).rejects.toThrow(/404/)
  })

  test('one already added says so', async () => {
    const preview = await previewMiniAppCatalog(URL_, {
      fetchImpl: serving({ schema: 1, apps: [] }),
      catalogImage: image,
      added: async () => [URL_],
    })
    expect(preview).toMatchObject({ apps: 0, added: true })
  })
})
