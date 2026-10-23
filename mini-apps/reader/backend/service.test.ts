import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppHelpers } from '@localixai/mini-app-sdk/backend'

import { ReaderService } from './service'

const jsonHelpers = {
  async readJson<T>(
    filePath: string,
    fallback: T,
    isValid?: (value: unknown) => value is T,
  ): Promise<T> {
    try {
      const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
      return !isValid || isValid(value) ? (value as T) : fallback
    } catch {
      return fallback
    }
  },
  async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, JSON.stringify(value))
  },
} as Pick<MiniAppHelpers, 'readJson' | 'writeJson'>

describe('ReaderService explicit library', () => {
  test('does not discover workspace files until the user opens one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-service-'))
    await writeFile(join(root, 'unopened.md'), '# Unopened\n\nMust stay out of the library.')
    await writeFile(join(root, 'opened.md'), '# Opened\n\nExplicitly selected.')
    const service = new ReaderService()

    expect((await service.list()).books).toEqual([])
    await service.read(root, 'opened.md')
    expect((await service.list()).books.map((book) => book.path)).toEqual([
      await realpath(join(root, 'opened.md')),
    ])
  })

  test('records an explicitly opened absolute path outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-root-'))
    const external = await mkdtemp(join(tmpdir(), 'localix-reader-library-'))
    const path = join(external, 'book.md')
    await writeFile(path, '# External\n\nReadable from anywhere on this computer.')
    const service = new ReaderService()

    await service.read(root, path)
    expect((await service.list()).books).toEqual([
      expect.objectContaining({ path: await realpath(path), title: 'External', format: 'md' }),
    ])
  })

  test('deduplicates the same file opened by relative and absolute paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-dedupe-'))
    const path = join(root, 'same.md')
    await writeFile(path, '# Same book')
    const service = new ReaderService()

    await service.read(root, 'same.md')
    await service.read(root, path)
    expect((await service.list()).books).toHaveLength(1)
  })

  test('persists explicit books and removal never deletes the source file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-persist-'))
    const dataDir = await mkdtemp(join(tmpdir(), 'localix-reader-data-'))
    const stateFile = join(dataDir, 'library.json')
    const path = join(root, 'keep.md')
    await writeFile(path, '# Keep the source')
    const first = new ReaderService(undefined, { filePath: stateFile, helpers: jsonHelpers })
    await first.read(root, path)

    const restored = new ReaderService(undefined, { filePath: stateFile, helpers: jsonHelpers })
    expect((await restored.list()).books.map((book) => book.path)).toEqual([await realpath(path)])
    expect(await restored.remove(root, { path: await realpath(path) })).toBe(true)
    expect((await restored.list()).books).toEqual([])
    expect((await stat(path)).isFile()).toBe(true)
  })

  test('agent/context reads do not resurrect a removed book', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-remove-context-'))
    const path = join(root, 'removed.md')
    await writeFile(path, '# Removed\n\nStill readable when explicitly linked.')
    const service = new ReaderService()
    await service.read(root, path)
    expect(await service.remove(root, { path: await realpath(path) })).toBe(true)

    const linked = await service.read(root, path, { remember: false })
    expect(linked.chapters[0]?.text).toContain('Still readable')
    expect((await service.list()).books).toEqual([])
  })

  test('searches content only across explicitly opened shelf books', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-shelf-search-'))
    await writeFile(join(root, 'opened.md'), '# Opened\n\nThe observable mesh connects agents.')
    await writeFile(join(root, 'unopened.md'), '# Unopened\n\nA hidden mesh must stay hidden.')
    const service = new ReaderService()
    await service.read(root, 'opened.md')

    const result = await service.searchLibrary(root, 'mesh')
    expect(result.total).toBe(1)
    expect(result.hits[0]?.book.title).toBe('Opened')
    expect(result.hits[0]?.match.match).toBe('mesh')
    expect((await service.list()).books).toHaveLength(1)
  })

  test('persists multi-collection membership and metadata overrides without mutating sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-organize-'))
    const dataDir = await mkdtemp(join(tmpdir(), 'localix-reader-organize-data-'))
    const stateFile = join(dataDir, 'library.json')
    const firstPath = join(root, 'first.md')
    const secondPath = join(root, 'second.md')
    await writeFile(firstPath, '# Parsed First\n\nOriginal file content.')
    await writeFile(secondPath, '# Parsed Second\n\nAnother source.')
    const firstRealPath = await realpath(firstPath)
    const secondRealPath = await realpath(secondPath)
    const service = new ReaderService(undefined, { filePath: stateFile, helpers: jsonHelpers })
    await service.read(root, firstPath)
    await service.read(root, secondPath)

    const research = await service.createCollection('Research')
    const favorites = await service.createCollection('Favorites')
    const duplicate = await service.createCollection(' research ').catch((error: unknown) => error)
    expect(duplicate).toBeInstanceOf(Error)
    expect((duplicate as Error).message).toContain('already exists')
    await service.setCollections(
      root,
      [{ path: firstPath }],
      [research.id, favorites.id, research.id],
    )
    await service.setCollections(root, [{ path: secondPath }], [favorites.id])
    await service.changeCollections(
      root,
      [{ path: firstPath }, { path: secondPath }],
      [research.id],
      [],
    )
    expect(
      (await service.list()).books.find((book) => book.path === secondRealPath)?.collectionIds,
    ).toEqual([favorites.id, research.id])
    await service.updateMetadata(root, { path: firstPath }, { title: 'My First', author: 'Ada' })

    // Reopening reparses source metadata but must not clobber user-owned overrides or shelves.
    await service.read(root, firstPath)
    const organized = (await service.list()).books.find((book) => book.path === firstRealPath)!
    expect(organized).toMatchObject({
      title: 'My First',
      author: 'Ada',
      sourceTitle: 'Parsed First',
      overrides: { title: 'My First', author: 'Ada' },
      collectionIds: [research.id, favorites.id],
    })
    expect(await readFile(firstPath, 'utf8')).toContain('# Parsed First')

    const restored = new ReaderService(undefined, { filePath: stateFile, helpers: jsonHelpers })
    expect((await restored.list()).collections.map((collection) => collection.name)).toEqual([
      'Favorites',
      'Research',
    ])
    expect((await restored.list()).books.find((book) => book.path === firstRealPath)?.title).toBe(
      'My First',
    )

    await restored.updateMetadata(root, { path: firstPath }, { title: null, author: null })
    expect((await restored.list()).books.find((book) => book.path === firstRealPath)).toMatchObject(
      {
        title: 'Parsed First',
        sourceTitle: 'Parsed First',
      },
    )
    expect(
      (await restored.list()).books.find((book) => book.path === firstRealPath)?.author,
    ).toBeUndefined()

    expect(await restored.deleteCollection(research.id)).toBe(true)
    expect(
      (await restored.list()).books.find((book) => book.path === firstRealPath)?.collectionIds,
    ).toEqual([favorites.id])
    expect(
      await restored.removeMany(root, [{ path: firstRealPath }, { path: secondRealPath }]),
    ).toBe(2)
    expect((await restored.list()).books).toEqual([])
    expect((await stat(firstPath)).isFile()).toBe(true)
    expect((await stat(secondPath)).isFile()).toBe(true)
  })
})

test('a shelf invalidation reloads external metadata and removes deleted cached rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localix-reader-sync-'))
  const shelf = join(root, 'library.json')
  const service = new ReaderService(undefined, { filePath: shelf, helpers: jsonHelpers })
  await writeFile(join(root, 'book.md'), '# Original')
  await service.read(root, 'book.md')
  const stored = JSON.parse(await readFile(shelf, 'utf8'))
  stored.books[0].overrides = { title: 'External edit' }
  await writeFile(shelf, JSON.stringify(stored))
  service.invalidateLibrary()
  expect((await service.list()).books[0]?.title).toBe('External edit')
  await writeFile(shelf, JSON.stringify({ version: 2, books: [], collections: [] }))
  service.invalidateLibrary()
  expect((await service.list()).books).toEqual([])
})
