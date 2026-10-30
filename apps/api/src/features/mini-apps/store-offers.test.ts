import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import { publicKeyOf } from '@localixai/mini-app-sdk/marketplace-signature'

import { hostedMiniAppMarketplace, servingAll } from '../../testing/mini-app-marketplace'
import type { KeptTrust } from './marketplace-trust'
import type { MiniAppMarketplaceSource } from './marketplaces'
import { createOfferReader } from './store-offers'

const LOCALIX_URL = 'https://localix.example.test/m/mini-app-marketplace.json'
const ADA_URL = 'https://ada.example.test/m/mini-app-marketplace.json'
const GRACE_URL =
  'https://github.com/grace/habits/releases/latest/download/mini-app-marketplace.json'

const source = (
  url: string,
  name: string,
  extra: Partial<MiniAppMarketplaceSource> = {},
): MiniAppMarketplaceSource => ({ url, name, vouches: false, builtIn: false, ...extra })

function trustStore(initial: Record<string, KeptTrust> = {}) {
  const kept = new Map(Object.entries(initial))
  return {
    kept,
    get: async (url: string) => kept.get(url),
    keep: async (url: string, trust: KeptTrust) => void kept.set(url, trust),
  }
}

describe('what the marketplaces offer', () => {
  test('each app under its identity, published by the owner, verified only where Localix vouches', async () => {
    const localix = hostedMiniAppMarketplace([{ name: 'notes' }], {
      url: LOCALIX_URL,
      name: 'localix',
      owner: 'Localix',
    })
    const ada = hostedMiniAppMarketplace([{ name: 'notes', version: '2.0.0' }], {
      url: ADA_URL,
      name: 'ada',
      owner: 'Ada',
    })
    const read = createOfferReader({
      sources: () => [
        source(LOCALIX_URL, 'localix', { vouches: true, builtIn: true }),
        source(ADA_URL, 'ada'),
      ],
      fetchImpl: servingAll(localix, ada),
      trust: trustStore(),
    })
    const { offers } = await read()
    expect([...offers.keys()]).toEqual(['notes@localix', 'notes@ada'])
    expect(offers.get('notes@localix')).toMatchObject({
      name: 'notes',
      marketplace: 'localix',
      publisher: { name: 'Localix', verified: true },
      source: LOCALIX_URL,
      from: LOCALIX_URL,
    })
    expect(offers.get('notes@ada')).toMatchObject({
      version: '2.0.0',
      publisher: { name: 'Ada', verified: false },
    })
  })

  test("a keeper's curation and rows count only where Localix vouches", async () => {
    const curated = {
      name: 'database',
      featured: true,
      installByDefault: true,
      suggestFor: { files: ['*.sql'] },
    }
    const rows = [{ id: 'data', title: 'Data', items: ['database'] }]
    const localix = hostedMiniAppMarketplace([curated], {
      url: LOCALIX_URL,
      name: 'localix',
      collections: rows,
    })
    const ada = hostedMiniAppMarketplace([curated], {
      url: ADA_URL,
      name: 'ada',
      collections: rows,
    })
    const { offers, editorial } = await createOfferReader({
      sources: () => [source(LOCALIX_URL, 'localix', { vouches: true }), source(ADA_URL, 'ada')],
      fetchImpl: servingAll(localix, ada),
      trust: trustStore(),
    })()
    expect(offers.get('database@localix')!.store).toMatchObject({
      featured: true,
      installByDefault: true,
      suggestFor: { files: ['*.sql'] },
    })
    const theirs = offers.get('database@ada')!.store
    expect([theirs.featured, theirs.installByDefault, theirs.suggestFor]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(editorial).toEqual([
      {
        source: LOCALIX_URL,
        collections: [
          {
            id: 'data',
            title: 'Data',
            style: 'row',
            items: [{ kind: 'mini-app', id: 'database@localix' }],
          },
        ],
      },
    ])
  })

  test('a marketplace calling itself what another already is offers nothing, and says so', async () => {
    const localix = hostedMiniAppMarketplace([{ name: 'notes' }], {
      url: LOCALIX_URL,
      name: 'localix',
    })
    const impostor = hostedMiniAppMarketplace([{ name: 'evil' }], { url: ADA_URL, name: 'localix' })
    const { offers, problems, failed } = await createOfferReader({
      sources: () => [source(LOCALIX_URL, 'localix', { vouches: true }), source(ADA_URL, 'ada')],
      fetchImpl: servingAll(localix, impostor),
      trust: trustStore(),
    })()
    expect([...offers.keys()]).toEqual(['notes@localix'])
    expect(failed[ADA_URL]).toBe(
      'it now calls itself "localix", not "ada"; remove it and add it again',
    )
    expect(problems).toHaveLength(1)
  })
})

describe('signatures, as each read is judged', () => {
  const key = generateKeyPairSync('ed25519').privateKey
  const next = generateKeyPairSync('ed25519').privateKey

  test('signed by a key Localix ships, its apps are signed; the keys it names next are kept', async () => {
    const localix = hostedMiniAppMarketplace([{ name: 'notes' }], {
      url: LOCALIX_URL,
      name: 'localix',
      signWith: [key, next],
      signingKeys: [publicKeyOf(next)],
    })
    const trust = trustStore()
    const { offers } = await createOfferReader({
      sources: () => [
        source(LOCALIX_URL, 'localix', { vouches: true, pinned: [publicKeyOf(key)] }),
      ],
      fetchImpl: localix.fetchImpl,
      trust,
    })()
    expect(offers.get('notes@localix')!.signature).toBe('signed')
    expect(trust.kept.get(LOCALIX_URL)).toEqual({
      keys: [publicKeyOf(next)],
      published: '2026-10-30T09:00:00.000Z',
      root: [publicKeyOf(key)],
    })
  })

  test('signed by another key, its signature has changed', async () => {
    const localix = hostedMiniAppMarketplace([{ name: 'notes' }], {
      url: LOCALIX_URL,
      name: 'localix',
      signWith: [next],
    })
    const { offers } = await createOfferReader({
      sources: () => [source(LOCALIX_URL, 'localix', { pinned: [publicKeyOf(key)] })],
      fetchImpl: localix.fetchImpl,
      trust: trustStore(),
    })()
    expect(offers.get('notes@localix')!.signature).toBe('mismatch')
  })

  test('an older release than one already read is refused, and the last good one stays', async () => {
    const ada = hostedMiniAppMarketplace([{ name: 'notes', version: '2.0.0' }], {
      url: ADA_URL,
      name: 'ada',
      published: '2026-10-30T09:00:00.000Z',
    })
    const trust = trustStore()
    let at = 0
    const read = createOfferReader({
      sources: () => [source(ADA_URL, 'ada')],
      fetchImpl: ada.fetchImpl,
      trust,
      now: () => at,
    })
    expect((await read()).offers.get('notes@ada')!.version).toBe('2.0.0')
    ada.release.published = '2026-10-01T09:00:00.000Z'
    ada.apps[0] = { name: 'notes', version: '1.0.0' }
    at = 60 * 60_000
    const { offers, failed } = await read({ fresh: true })
    expect(offers.get('notes@ada')!.version).toBe('2.0.0')
    expect(failed[ADA_URL]).toBe(
      'an older release than the one already read (2026-10-30T09:00:00.000Z)',
    )
  })
})

describe('an app a list links to', () => {
  test('is read from its own marketplace, offered under the list, the list’s words filling gaps', async () => {
    const author = generateKeyPairSync('ed25519').privateKey
    const list = hostedMiniAppMarketplace(
      [
        {
          name: 'habits',
          link: { source: 'github', repo: 'grace/habits' },
          description: 'Habits, as the list says',
          homepage: 'https://grace.example/habits',
        },
      ],
      { url: ADA_URL, name: 'localix-community' },
    )
    const grace = hostedMiniAppMarketplace([{ name: 'habits', description: '' }], {
      url: GRACE_URL,
      name: 'grace',
      owner: 'Grace',
      signWith: [author],
    })
    const trust = trustStore()
    const { offers } = await createOfferReader({
      sources: () => [source(ADA_URL, 'localix-community', { builtIn: true })],
      fetchImpl: servingAll(list, grace),
      trust,
    })()
    expect(offers.get('habits@localix-community')).toMatchObject({
      name: 'habits',
      marketplace: 'localix-community',
      description: 'Habits, as the list says',
      publisher: { name: 'Grace', verified: false },
      source: ADA_URL,
      from: GRACE_URL,
      signature: 'signed',
      store: { homepage: 'https://grace.example/habits' },
    })
    expect(trust.kept.get(GRACE_URL)?.keys).toEqual([publicKeyOf(author)])
  })

  test('one its marketplace does not list is a problem; the rest of the list stays', async () => {
    const list = hostedMiniAppMarketplace(
      [
        {
          name: 'gone',
          link: { source: 'github', repo: 'grace/habits' },
          description: 'Gone away',
        },
      ],
      { url: ADA_URL, name: 'list' },
    )
    const grace = hostedMiniAppMarketplace([{ name: 'habits' }], { url: GRACE_URL, name: 'grace' })
    const { offers, problems } = await createOfferReader({
      sources: () => [source(ADA_URL, 'list')],
      fetchImpl: servingAll(list, grace),
      trust: trustStore(),
    })()
    expect(offers.size).toBe(0)
    expect(problems).toEqual([`gone is not in its marketplace (${GRACE_URL})`])
  })
})

describe('revoked apps', () => {
  test('revoked whole, an app is not offered and its revocation is read', async () => {
    const ada = hostedMiniAppMarketplace(
      [{ name: 'notes', revoked: { reason: 'Sends notes away.' } }, { name: 'timer' }],
      { url: ADA_URL, name: 'ada' },
    )
    const { offers, revocations } = await createOfferReader({
      sources: () => [source(ADA_URL, 'ada')],
      fetchImpl: ada.fetchImpl,
      trust: trustStore(),
    })()
    expect([...offers.keys()]).toEqual(['timer@ada'])
    expect(revocations).toEqual([
      { id: 'notes@ada', name: 'notes', marketplace: 'ada', reason: 'Sends notes away.' },
    ])
  })

  test('revoked by version, the fixed version is still offered', async () => {
    const ada = hostedMiniAppMarketplace(
      [{ name: 'notes', version: '1.3.0', revoked: { reason: 'Broken.', versions: ['1.2.0'] } }],
      { url: ADA_URL, name: 'ada' },
    )
    const { offers, revocations } = await createOfferReader({
      sources: () => [source(ADA_URL, 'ada')],
      fetchImpl: ada.fetchImpl,
      trust: trustStore(),
    })()
    expect(offers.get('notes@ada')!.version).toBe('1.3.0')
    expect(revocations).toEqual([
      {
        id: 'notes@ada',
        name: 'notes',
        marketplace: 'ada',
        reason: 'Broken.',
        versions: ['1.2.0'],
      },
    ])
  })

  test("a linked app its author revoked is revoked under the list's identity", async () => {
    const list = hostedMiniAppMarketplace(
      [
        {
          name: 'habits',
          link: { source: 'github', repo: 'grace/habits' },
          description: 'Habits app',
        },
      ],
      { url: ADA_URL, name: 'list' },
    )
    const grace = hostedMiniAppMarketplace(
      [{ name: 'habits', revoked: { reason: 'Withdrawn by its author.' } }],
      { url: GRACE_URL, name: 'grace' },
    )
    const { offers, revocations } = await createOfferReader({
      sources: () => [source(ADA_URL, 'list')],
      fetchImpl: servingAll(list, grace),
      trust: trustStore(),
    })()
    expect(offers.size).toBe(0)
    expect(revocations).toEqual([
      {
        id: 'habits@list',
        name: 'habits',
        marketplace: 'list',
        reason: 'Withdrawn by its author.',
      },
    ])
  })

  test('archives Localix blocks are read from its own marketplace only', async () => {
    const blockedArchives = [{ sha256: 'b'.repeat(64), reason: 'Malware.' }]
    const localix = hostedMiniAppMarketplace([], {
      url: LOCALIX_URL,
      name: 'localix',
      blockedArchives,
    })
    const ada = hostedMiniAppMarketplace([], { url: ADA_URL, name: 'ada', blockedArchives })
    const { blocked } = await createOfferReader({
      sources: () => [source(LOCALIX_URL, 'localix', { vouches: true }), source(ADA_URL, 'ada')],
      fetchImpl: servingAll(localix, ada),
      trust: trustStore(),
    })()
    expect(blocked).toEqual(blockedArchives)
  })
})
