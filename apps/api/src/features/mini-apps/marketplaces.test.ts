import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import { publicKeyOf, signMarketplace } from '@localixai/mini-app-sdk/marketplace-signature'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMiniAppMarketplaces } from './marketplaces'

const LOCALIX =
  'https://github.com/rsaryev/localix-marketplace/releases/latest/download/mini-app-marketplace.json'
const ADA = 'https://ada.example.test/mini-app-marketplace.json'
const GRACE_REPO =
  'https://github.com/grace/apps/releases/latest/download/mini-app-marketplace.json'

const released = (name: string) => ({
  schema: 3,
  name,
  owner: { name: 'Someone' },
  published: '2026-10-30T09:00:00.000Z',
  apps: [],
})

function serving(files: Record<string, unknown>, signWith?: Parameters<typeof publicKeyOf>[0]) {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = files[url.replace(/\.sig$/, '')]
    if (!body) return new Response('missing', { status: 404 })
    const text = JSON.stringify(body)
    if (!url.endsWith('.sig')) return new Response(text)
    return signWith
      ? new Response(signMarketplace(new TextEncoder().encode(text), [signWith]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
}

async function setup(fetchImpl: typeof fetch) {
  const db = createDatabase()
  await migrateToLatest(db)
  const marketplaces = createMiniAppMarketplaces({
    db,
    builtIn: async () => [
      { url: LOCALIX, name: 'localix', vouches: true, builtIn: true, id: 'localix-mini-apps' },
    ],
    fetchImpl,
  })
  const notices = async () =>
    (await db.selectFrom('change_events').select('entity').execute()).map((row) => row.entity)
  return { db, marketplaces, notices }
}

describe('the marketplaces the store reads', () => {
  test("Localix's own is always there and cannot be removed", async () => {
    const { marketplaces } = await setup(serving({}))
    expect(await marketplaces.list()).toEqual([
      { url: LOCALIX, name: 'localix', vouches: true, builtIn: true, id: 'localix-mini-apps' },
    ])
    await expect(marketplaces.remove(LOCALIX)).rejects.toThrow(/comes with Localix/)
  })

  test('one added is read first, kept under its name, announced, and not vouched for', async () => {
    const { marketplaces, notices } = await setup(serving({ [ADA]: released('ada') }))
    expect(await marketplaces.add(ADA)).toEqual({ url: ADA, name: 'ada' })
    expect(await marketplaces.list()).toContainEqual({
      url: ADA,
      name: 'ada',
      vouches: false,
      builtIn: false,
    })
    expect(await notices()).toContain('mini-app.marketplace')
  })

  test('owner/name adds the marketplace that GitHub repository releases', async () => {
    const { marketplaces } = await setup(serving({ [GRACE_REPO]: released('grace') }))
    expect(await marketplaces.add('grace/apps')).toEqual({ url: GRACE_REPO, name: 'grace' })
  })

  test('a signed one keeps the keys of its first read, so a later key change is seen', async () => {
    const key = generateKeyPairSync('ed25519').privateKey
    const { marketplaces } = await setup(serving({ [ADA]: released('ada') }, key))
    await marketplaces.add(ADA)
    expect(await marketplaces.trust.get(ADA)).toEqual({
      keys: [publicKeyOf(key)],
      published: '2026-10-30T09:00:00.000Z',
    })
  })

  test('an address that is not https, a file or owner/name is refused before anything is read', async () => {
    const { marketplaces } = await setup(serving({}))
    await expect(marketplaces.add('http://plain.example/m.json')).rejects.toThrow(
      /https:\/\/ address, a file:\/\/ path or a GitHub owner\/name/,
    )
  })

  test('one that cannot be read is not kept, and says why', async () => {
    const { marketplaces } = await setup(serving({}))
    await expect(marketplaces.add(ADA)).rejects.toThrow(/answered 404/)
    expect(await marketplaces.list()).toHaveLength(1)
  })

  test("a name Localix's own uses, or one already added, is refused: a name is one marketplace", async () => {
    const other = 'https://other.example.test/mini-app-marketplace.json'
    const { marketplaces } = await setup(
      serving({
        [ADA]: released('localix'),
        [other]: released('grace'),
        [GRACE_REPO]: released('grace'),
      }),
    )
    await expect(marketplaces.add(ADA)).rejects.toThrow(/"localix" is already/)
    await marketplaces.add(other)
    await expect(marketplaces.add('grace/apps')).rejects.toThrow(/"grace" is already/)
  })

  test('adding one again changes nothing', async () => {
    const { marketplaces, notices } = await setup(serving({ [ADA]: released('ada') }))
    await marketplaces.add(ADA)
    await marketplaces.add(ADA)
    expect((await notices()).filter((entity) => entity === 'mini-app.marketplace')).toHaveLength(1)
  })

  test('removing one forgets it and what was kept for it, so a new key can be accepted', async () => {
    const key = generateKeyPairSync('ed25519').privateKey
    const { marketplaces, notices } = await setup(serving({ [ADA]: released('ada') }, key))
    await marketplaces.add(ADA)
    await marketplaces.remove(ADA)
    expect(await marketplaces.list()).toHaveLength(1)
    expect(await marketplaces.trust.get(ADA)).toBeUndefined()
    expect((await notices()).filter((entity) => entity === 'mini-app.marketplace')).toHaveLength(2)
  })

  test('what is kept for any marketplace read, built in or linked, is stored and announced', async () => {
    const { marketplaces, notices } = await setup(serving({}))
    await marketplaces.trust.keep(LOCALIX, {
      keys: ['k'],
      published: '2026-10-30T09:00:00.000Z',
      root: ['r'],
    })
    expect(await marketplaces.trust.get(LOCALIX)).toEqual({
      keys: ['k'],
      published: '2026-10-30T09:00:00.000Z',
      root: ['r'],
    })
    expect(await notices()).toEqual(['mini-app.marketplace'])
  })
})
