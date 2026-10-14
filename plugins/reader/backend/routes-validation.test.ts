import { expect, test } from 'bun:test'

import { createReaderRoutes } from './routes'

test.each(['', '?path=book.md&mediaId=book'])(
  'rejects ambiguous or missing book identity: %s',
  async (query) => {
    const app = createReaderRoutes({} as never)
    for (const route of ['/document', '/stats']) {
      const response = await app.request(`${route}${query}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Provide either path or mediaId' })
    }
  },
)

test('rejects chapter search without a chapter before reading the book', async () => {
  const app = createReaderRoutes({} as never)
  const response = await app.request('/search?mediaId=book&query=word&scope=chapter')
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'Chapter scope requires a chapter' })
})

test('retains distinct search defaults and converts query strings before calling the service', async () => {
  const calls: unknown[] = []
  const app = createReaderRoutes({
    async readMedia(...args: unknown[]) {
      calls.push(args)
      return {
        chapters: [
          {
            id: 'chapter',
            index: 0,
            title: 'Chapter',
            text: Array.from({ length: 201 }, () => 'WORD').join(' '),
          },
        ],
      }
    },
    async searchLibrary(...args: unknown[]) {
      calls.push(args)
      return { query: 'word', total: 0, truncated: false, hits: [] }
    },
  } as never)
  const book = await app.request('/search?mediaId=book&query=%20word%20', undefined, {
    cwd: '/workspace',
  } as never)
  expect(book.status).toBe(200)
  expect(await book.json()).toMatchObject({ query: 'word', total: 200, truncated: true })
  const library = await app.request('/library/search?query=%20word%20', undefined, {
    cwd: '/workspace',
  } as never)
  expect(library.status).toBe(200)
  expect(calls).toEqual([
    ['book', undefined, { remember: false }],
    [
      '/workspace',
      'word',
      { mode: 'contains', matchCase: false, matchDiacritics: false, nearbyWords: 10, limit: 100 },
    ],
  ])
})
