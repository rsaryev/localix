import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { signCatalog } from './catalog-signature'
import { createMiniAppCatalogs } from './catalogs'

const HOSTED = 'https://localix.example.test/mini-app-catalog.json'
const THEIRS = 'https://ada.example.test/releases/latest/download/mini-app-catalog.json'

const catalogBody = { schema: 1, apps: [] }
const serving = (urls: Record<string, unknown>) =>
  (async (input: string | URL | Request) => {
    const body = urls[String(input instanceof Request ? input.url : input)]
    return body ? Response.json(body) : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch

async function setup(fetchImpl = serving({ [THEIRS]: catalogBody })) {
  const db = createDatabase()
  await migrateToLatest(db)
  const catalogs = createMiniAppCatalogs({
    db,
    builtIn: async () => [{ kind: 'catalog', url: HOSTED, vouches: true }],
    fetchImpl,
  })
  const notices = async () =>
    (await db.selectFrom('change_events').select('entity').execute()).map((row) => row.entity)
  return { db, catalogs, notices }
}

describe('the catalogs the store reads', () => {
  test('the Localix catalog is always there and cannot be removed', async () => {
    const { catalogs } = await setup()
    expect(await catalogs.list()).toEqual([{ url: HOSTED, builtIn: true }])
    await expect(catalogs.remove(HOSTED)).rejects.toThrow(/Localix/)
  })

  test('an added catalog is read first, kept, announced, and offered as unverified', async () => {
    const { catalogs, notices } = await setup()
    await catalogs.add(THEIRS)
    expect(await catalogs.list()).toEqual([
      { url: HOSTED, builtIn: true },
      { url: THEIRS, builtIn: false },
    ])
    expect(await catalogs.sources()).toContainEqual({
      kind: 'catalog',
      url: THEIRS,
      vouches: false,
    })
    expect((await notices()).join()).toContain('mini-app.catalog')

    await catalogs.remove(THEIRS)
    expect(await catalogs.list()).toEqual([{ url: HOSTED, builtIn: true }])
  })

  test('what is not a reachable catalog, or not HTTPS or a file, is refused before it is kept', async () => {
    const { catalogs } = await setup()
    await expect(catalogs.add('https://ada.example.test/nothing.json')).rejects.toThrow(/404/)
    await expect(catalogs.add('http://ada.example.test/catalog.json')).rejects.toThrow(/HTTPS/)
    await expect(catalogs.add('not a url')).rejects.toThrow(/HTTPS/)
    expect(await catalogs.list()).toHaveLength(1)
  })

  test('adding one twice keeps one', async () => {
    const { catalogs } = await setup()
    await catalogs.add(THEIRS)
    await catalogs.add(` ${THEIRS} `)
    expect(await catalogs.list()).toHaveLength(2)
  })

  /** THEIRS served signed with a new key; returns the key as Localix keeps it. */
  const signedBy = () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const text = JSON.stringify(catalogBody)
    const signature = signCatalog(new TextEncoder().encode(text), privateKey)
    const fetchImpl = (async (input: string | URL) =>
      String(input) === THEIRS
        ? new Response(text)
        : String(input) === `${THEIRS}.sig`
          ? new Response(signature)
          : new Response('missing', { status: 404 })) as unknown as typeof fetch
    return { fetchImpl, key: JSON.parse(signature).key as string }
  }

  test('a catalog added signed keeps the key it was signed with, until it is removed', async () => {
    const first = signedBy()
    const { catalogs } = await setup(first.fetchImpl)
    await catalogs.add(THEIRS)
    expect(await catalogs.sources()).toContainEqual({
      kind: 'catalog',
      url: THEIRS,
      vouches: false,
      key: first.key,
    })

    // Removing it and adding it again is how a person accepts a publisher's new key.
    await catalogs.remove(THEIRS)
    const second = signedBy()
    const again = createMiniAppCatalogs({
      db: (await setup()).db,
      builtIn: async () => [],
      fetchImpl: second.fetchImpl,
    })
    await again.add(THEIRS)
    expect((await again.sources()).find((source) => source.url === THEIRS)?.key).toBe(second.key)
  })

  test('a catalog added unsigned keeps the key of its first signed read, and only that one', async () => {
    const { catalogs, notices } = await setup()
    await catalogs.add(THEIRS)
    expect((await catalogs.sources()).find((source) => source.url === THEIRS)?.key).toBeUndefined()

    await catalogs.pinKey(THEIRS, 'K1')
    await catalogs.pinKey(THEIRS, 'K2')
    expect((await catalogs.sources()).find((source) => source.url === THEIRS)?.key).toBe('K1')
    expect((await notices()).filter((entity) => entity === 'mini-app.catalog')).toHaveLength(2)
  })
})
