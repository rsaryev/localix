import { expect, test } from 'bun:test'
import type { MiniAppHelpers } from '@localixai/mini-app-sdk/backend'

import { ReaderService } from './service'

const book = {
  path: 'book.md',
  title: 'Source title',
  author: 'Source author',
  format: 'md' as const,
  size: 10,
  updatedAt: '2026-01-01',
}
const collection = { id: 'shelf', name: 'Shelf', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

function serviceWithState(state: unknown): ReaderService {
  const helpers: Pick<MiniAppHelpers, 'readJson' | 'writeJson'> = {
    async readJson<T>(
      _filePath: string,
      fallback: T,
      isValid?: (value: unknown) => value is T,
    ): Promise<T> {
      return !isValid || isValid(state) ? (state as T) : fallback
    },
    async writeJson() {},
  }
  return new ReaderService(undefined, { filePath: 'library.json', helpers })
}

test.each([
  { format: 'unknown' },
  { cover: 'https://example.test/cover.png' },
  { overrides: { title: '' } },
  { overrides: { author: 'a'.repeat(301) } },
  { collectionIds: Array.from({ length: 33 }, () => 'shelf') },
  { collectionIds: ['a'.repeat(129)] },
])('rejects the entire stored shelf when a book is invalid: %j', async (patch) => {
  const service = serviceWithState({
    books: [book, { ...book, ...patch }],
    collections: [collection],
  })
  expect(await service.list()).toEqual({ books: [], collections: [] })
})

test.each([
  ['empty name', [{ ...collection, name: '' }]],
  ['long name', [{ ...collection, name: 'a'.repeat(81) }]],
  ['long id', [{ ...collection, id: 'a'.repeat(129) }]],
  ['too many collections', Array.from({ length: 201 }, () => collection)],
])('rejects invalid stored collections: %s', async (_reason, collections) => {
  expect(await serviceWithState({ books: [book], collections }).list()).toEqual({
    books: [],
    collections: [],
  })
})

test('loads legacy metadata and filters duplicate or missing shelf memberships', async () => {
  const legacy = await serviceWithState({ books: [book] }).list()
  expect(legacy.books[0]).toEqual({
    ...book,
    sourceTitle: book.title,
    sourceAuthor: book.author,
    collectionIds: [],
  })
  const stored = {
    ...book,
    sourceTitle: 'Original',
    sourceAuthor: 'Original author',
    overrides: { title: 'Custom', author: '' },
    collectionIds: ['shelf', 'missing', 'shelf'],
  }
  const result = await serviceWithState({ books: [stored], collections: [collection] }).list()
  expect(result.books[0]).toEqual({
    ...stored,
    title: 'Custom',
    author: undefined,
    collectionIds: ['shelf'],
  })
  expect(result.collections).toEqual([collection])
  expect(stored.collectionIds).toEqual(['shelf', 'missing', 'shelf'])
})
