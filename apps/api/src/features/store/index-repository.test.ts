import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { tempDirPerTest } from '@localixai/testing'
import { makeListing } from '@localixai/store/testing'
import type { Listing } from '@localixai/store'

import { openStoreIndexDatabase, STORE_INDEX_VERSION } from './index-repository-open'
import { createStoreIndexRepository } from './index-repository'
import { memoryIndex } from './testing'

const tmp = tempDirPerTest('store-index')
let open: ReturnType<typeof memoryIndex> | null = null
afterEach(async () => {
  await open?.close()
  open = null
})
const index = () => (open = memoryIndex())

const ids = (listings: readonly Listing[]) => listings.map((listing) => listing.ref.id)
const plugin = (id: string, over: Partial<Listing> = {}) =>
  makeListing({ id, kind: 'plugin', summary: `${id} helps`, ...over })

describe('trust in the index', () => {
  test('a listing whose provider rates no source is neither community nor trusted', async () => {
    const { repo, put } = index()
    await put('mcp:yours', [
      plugin('own', { authored: 'user', source: { id: 'mcp:yours', label: 'Your servers' } }),
    ])
    await put('c', [plugin('theirs', { source: { id: 'c', label: 'C', trust: 'community' } })])
    const only = async (filters: Parameters<typeof repo.page>[1]) =>
      ids((await repo.page('u1', filters, { limit: 40 })).listings)
    expect(await only({ trust: 'community' })).toEqual(['theirs'])
    expect(await only({ trusted: true })).toEqual([])
  })
})

describe('the Store index', () => {
  test('replacing one source leaves the others as they were', async () => {
    const { repo, put } = index()
    await put('official', [plugin('a'), plugin('b')])
    await put('community', [plugin('c')])
    await put('official', [plugin('d')])
    const page = await repo.page('u1', {}, { limit: 40 })
    expect(ids(page.listings).sort()).toEqual(['c', 'd'])
  })

  test('pages follow each other by a cursor, in score order, none twice', async () => {
    const { repo, put } = index()
    await put('s', [
      plugin('low'),
      plugin('top', { featured: true, source: { id: 's', label: 'S', trust: 'localix' } }),
      plugin('mid-a', { source: { id: 's', label: 'S', trust: 'official' } }),
      plugin('mid-b', { source: { id: 's', label: 'S', trust: 'official' } }),
      plugin('lower'),
    ])
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await repo.page('u1', {}, { limit: 2, ...(cursor ? { cursor } : {}) })
      seen.push(...ids(page.listings))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(['top', 'mid-a', 'mid-b', 'low', 'lower'])
  })

  test('the open project lifts the listings that are about what it is written in', async () => {
    const { repo, put } = index()
    await put('s', [
      plugin('python-lsp', { tags: ['python'] }),
      plugin('ts-lsp', { tags: ['typescript'] }),
    ])
    expect(ids((await repo.page('u1', {}, { limit: 40, boost: ['typescript'] })).listings)).toEqual(
      ['ts-lsp', 'python-lsp'],
    )
  })

  test('two sources listing one origin show it once, under the higher weight, also in the other', async () => {
    const { repo, put } = index()
    const origin = 'git:github.com/acme/lint'
    await put('community', [
      plugin('lint@community', { origin, source: { id: 'community', label: 'Community' } }),
    ])
    await put('official', [
      plugin('lint@official', {
        origin,
        source: { id: 'official', label: 'Official', trust: 'official' },
      }),
    ])
    const page = await repo.page('u1', {}, { limit: 40 })
    expect(ids(page.listings)).toEqual(['lint@official'])
    expect(page.listings[0]!.alsoIn).toEqual([{ id: 'community', label: 'Community' }])
  })

  test('what a person wrote has its own shelf and count, installed or not', async () => {
    const { repo, put } = index()
    await put('s', [plugin('fetched'), plugin('mine', { authored: 'user' })])
    expect(ids((await repo.page('u1', { shelf: 'yours' }, { limit: 40 })).listings)).toEqual([
      'mine',
    ])
    expect((await repo.facets('u1', {})).shelves).toMatchObject({ yours: 1 })
    const [first] = (await repo.page('u1', { shelf: 'yours' }, { limit: 40 })).listings
    expect(first!.authored).toBe('user')
  })

  test('a source that lists one origin twice is "also in" once', async () => {
    const { repo, put } = index()
    const origin = 'git:github.com/acme/lint'
    await put('community', [
      plugin('lint@community', { origin, source: { id: 'community', label: 'Community' } }),
      plugin('lint-again@community', { origin, source: { id: 'community', label: 'Community' } }),
    ])
    await put('official', [
      plugin('lint@official', {
        origin,
        source: { id: 'official', label: 'Official', trust: 'official' },
      }),
    ])
    const [listing] = (await repo.page('u1', {}, { limit: 40 })).listings
    expect(listing!.alsoIn).toEqual([{ id: 'community', label: 'Community' }])
  })

  test('the copy a person installed shows even when another source outranks it', async () => {
    const { repo, put } = index()
    const origin = 'git:github.com/acme/lint'
    await put('official', [
      plugin('lint@official', {
        origin,
        source: { id: 'official', label: 'Official', trust: 'official' },
      }),
    ])
    await put('community', [
      plugin('lint@community', {
        origin,
        installs: [{ scope: 'user', enabled: true }],
      }),
    ])
    expect(ids((await repo.page('u1', { shelf: 'installed' }, { limit: 40 })).listings)).toEqual([
      'lint@community',
    ])
  })

  test('the Installed shelf and its count leave out what you wrote and what comes bundled', async () => {
    const { repo, put } = index()
    const installs = [{ scope: 'user' as const, enabled: true }]
    await put('s', [
      plugin('fetched', { installs }),
      plugin('mine', { authored: 'user', installs }),
      plugin('builtin', { bundled: true, installs }),
    ])
    expect(ids((await repo.page('u1', { shelf: 'installed' }, { limit: 40 })).listings)).toEqual([
      'fetched',
    ])
    expect((await repo.facets('u1', {})).shelves).toMatchObject({ installed: 1, yours: 1 })
    const page = await repo.page('u1', { shelf: 'package:plugin' }, { limit: 40 })
    expect(page.listings.find((l) => l.ref.id === 'builtin')?.bundled).toBe(true)
  })

  test('facets count components on capability shelves, and the filtered set by category', async () => {
    const { repo, put } = index()
    await put('s', [
      plugin('vcs', {
        category: 'development',
        components: [
          { kind: 'command', name: '/commit' },
          { kind: 'command', name: '/push' },
          { kind: 'command', name: '/pr' },
        ],
        contents: { command: 3 },
      }),
      plugin('pg', {
        category: 'database',
        installs: [{ scope: 'user', enabled: true, updateTo: '2' }],
      }),
    ])
    const facets = await repo.facets('u1', { shelf: 'package:plugin' })
    expect(facets.shelves).toEqual({
      'package:plugin': 2,
      'capability:command': 3,
      installed: 1,
      updates: 1,
    })
    expect(facets.component).toEqual({ command: 3 })
    expect(facets.category).toEqual({ Development: 1, Data: 1 })
    expect(facets.installed).toBe(1)
  })

  test('Skills is one shelf and one count: standalone skills and the skills inside plugins', async () => {
    const { repo, put } = index()
    await put('s', [
      makeListing({ id: 'user:review', kind: 'skill', contents: { skill: 1 } }),
      plugin('lint', {
        components: [
          { kind: 'skill', name: 'fix' },
          { kind: 'skill', name: 'explain' },
        ],
        contents: { skill: 2 },
      }),
      plugin('empty'),
    ])
    const page = await repo.page('u1', { shelf: 'capability:skill' }, { limit: 40 })
    expect(ids(page.listings).sort()).toEqual(['lint', 'user:review'])
    const facets = await repo.facets('u1', {})
    expect(facets.shelves).toEqual({ 'package:plugin': 2, 'capability:skill': 3 })
  })

  test('word candidates come from FTS5, best match first, prefixes as one types', async () => {
    const { repo, put } = index()
    await put('s', [
      plugin('notes', { summary: 'Keep notes next to your postgres schema' }),
      plugin('postgres-mcp', { displayName: 'Postgres', summary: 'Query a database' }),
    ])
    const found = await repo.wordCandidates('u1', '"postg"*', {}, 10)
    expect(found.map((hit) => hit.ref.id)).toEqual(['postgres-mcp', 'notes'])
  })

  test('what a fetched package contains outlives the next replace of its source', async () => {
    const { repo, put } = index()
    const remote = plugin('remote', { contents: 'unknown' })
    await put('s', [remote])
    await repo.rememberComponents(remote.ref, [{ kind: 'skill', name: 'review' }])
    await put('s', [remote])
    const [listing] = (await repo.page('u1', { shelf: 'capability:skill' }, { limit: 40 })).listings
    expect(listing?.contents).toEqual({ skill: 1 })
    expect(listing?.components).toEqual([{ kind: 'skill', name: 'review' }])
  })
})

describe('the index file', () => {
  test('a file of another schema version is deleted and built again', async () => {
    const file = join(tmp(), 'store-index.sqlite')
    const first = openStoreIndexDatabase(file)
    await createStoreIndexRepository(first.db).replaceSource('plugin', 's', [], {
      revision: 'r1',
      now: 'now',
    })
    await first.close()
    const raw = new Database(file)
    raw.run("UPDATE meta SET value = ? WHERE key = 'version'", [String(STORE_INDEX_VERSION + 1)])
    raw.close()
    const again = openStoreIndexDatabase(file)
    expect(await createStoreIndexRepository(again.db).sourceRevision('plugin', 's')).toBeNull()
    await again.close()
  })

  test('a file that is not a database is replaced, not a reason to fail', async () => {
    const file = join(tmp(), 'store-index.sqlite')
    await Bun.write(file, 'not sqlite at all, but long enough to have a header of sorts')
    const opened = openStoreIndexDatabase(file)
    expect(await createStoreIndexRepository(opened.db).count()).toBe(0)
    await opened.close()
  })
})
