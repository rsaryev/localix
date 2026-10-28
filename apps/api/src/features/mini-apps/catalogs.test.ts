import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
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
})
