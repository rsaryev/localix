import { describe, expect, test } from 'bun:test'

import { previewMarketplace } from './marketplace-preview'

const URL_ = 'https://ada.example.test/releases/latest/download/mini-app-marketplace.json'
const sha = 'a'.repeat(64)
const archive = (name: string) => ({
  source: 'archive',
  url: `${name}.tar.gz`,
  bytes: 10,
  sha256: sha,
})
const app = (name: string, icon = true) => ({
  name,
  displayName: name.toUpperCase(),
  version: '1.0.0',
  source: archive(name),
  ...(icon ? { icon: { url: `${name}.svg`, bytes: 10, sha256: sha, type: 'image/svg+xml' } } : {}),
})
const marketplace = (apps: unknown[]) => ({ schema: 3, name: 'ada', owner: { name: 'Ada' }, apps })
/** Serves the marketplace at its address, with no signature beside it. */
const serving = (body: unknown, status = 200) =>
  (async (input: string) =>
    String(input) === URL_
      ? new Response(JSON.stringify(body), { status })
      : new Response('missing', { status: 404 })) as unknown as typeof fetch

const image = async () => ({ bytes: new TextEncoder().encode('<svg/>'), type: 'image/svg+xml' })

describe('previewing a marketplace before it is added', () => {
  test('says what it calls itself, who keeps it, how many apps, the first icons, and that it is unverified', async () => {
    const preview = await previewMarketplace(` ${URL_} `, {
      fetchImpl: serving(
        marketplace([
          app('notes'),
          app('timer'),
          app('radio', false),
          { name: 'gone', revoked: { reason: 'Withdrawn.' } },
          { name: 'habits', source: { source: 'github', repo: 'grace/habits' } },
        ]),
      ),
      marketplaceImage: image,
      added: async () => [],
    })
    expect(preview).toMatchObject({
      url: URL_,
      name: 'ada',
      publishers: ['Ada'],
      apps: 4,
      verified: false,
      added: false,
    })
    expect(preview.icons.map(({ name }) => name)).toEqual(['notes', 'timer'])
    expect(preview.icons[0]!.src).toStartWith('data:image/svg+xml;base64,')
  })

  test('a GitHub repository is read as the marketplace its latest release publishes', async () => {
    const asked: string[] = []
    const fetchImpl = (async (input: string) => {
      asked.push(String(input))
      return new Response('missing', { status: 404 })
    }) as unknown as typeof fetch
    await previewMarketplace('acme/apps', {
      fetchImpl,
      marketplaceImage: image,
      added: async () => [],
    }).catch(() => {})
    expect(asked[0]).toBe(
      'https://github.com/acme/apps/releases/latest/download/mini-app-marketplace.json',
    )
  })

  test('an address that is not a marketplace is refused with the reason, before anything is kept', async () => {
    const deps = { marketplaceImage: image, added: async () => [] }
    await expect(
      previewMarketplace('http://ada.example.test/m.json', { ...deps, fetchImpl: serving({}) }),
    ).rejects.toThrow(/https:\/\//)
    await expect(
      previewMarketplace(URL_, { ...deps, fetchImpl: serving({}, 404) }),
    ).rejects.toThrow(/404/)
    await expect(
      previewMarketplace(URL_, { ...deps, fetchImpl: serving({ schema: 1, apps: [] }) }),
    ).rejects.toThrow(/schema 3/)
  })

  test('one already added says so', async () => {
    const preview = await previewMarketplace(URL_, {
      fetchImpl: serving(marketplace([])),
      marketplaceImage: image,
      added: async () => [URL_],
    })
    expect(preview).toMatchObject({ apps: 0, added: true })
  })
})
