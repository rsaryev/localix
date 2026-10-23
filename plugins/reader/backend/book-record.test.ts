import { describe, expect, test } from 'bun:test'
import type { ReaderBookSummary } from '../shared/contracts'
import { bookFromMedia, bookFromPath } from './book-record'
import type { ParsedReaderDocument } from './chapters'

const parsed = (author?: string, cover?: string) =>
  ({
    document: { title: 'Source title', format: 'epub', ...(author ? { author } : {}) },
    chapters: [],
    ...(cover ? { cover } : {}),
  }) as unknown as ParsedReaderDocument

const previous = {
  path: '/old.epub',
  title: 'Mine',
  sourceTitle: 'Source title',
  overrides: { title: 'Mine', author: 'Me' },
  collectionIds: ['shelf'],
  format: 'epub',
  size: 1,
  updatedAt: '2030-01-01T00:00:00.000Z',
} as unknown as ReaderBookSummary

describe('book records', () => {
  test('a path book keeps the reader’s overrides and collections over the source metadata', () => {
    const book = bookFromPath('/b.epub', parsed('Author', 'c.png'), previous, 9, '2026-01-01')
    expect(book).toEqual({
      path: '/b.epub',
      cover: 'c.png',
      title: 'Mine',
      author: 'Me',
      sourceTitle: 'Source title',
      sourceAuthor: 'Author',
      overrides: { title: 'Mine', author: 'Me' },
      collectionIds: ['shelf'],
      format: 'epub',
      size: 9,
      // The newer of the stored and the observed timestamp.
      updatedAt: '2030-01-01T00:00:00.000Z',
    } as unknown as ReaderBookSummary)
    expect(Object.keys(book)).toEqual([
      'path',
      'cover',
      'title',
      'author',
      'sourceTitle',
      'sourceAuthor',
      'overrides',
      'collectionIds',
      'format',
      'size',
      'updatedAt',
    ])
  })

  test('a fresh book has only the source metadata it carries', () => {
    expect(bookFromPath('/b.epub', parsed(), undefined, 3, '2026-01-01')).toEqual({
      path: '/b.epub',
      title: 'Source title',
      sourceTitle: 'Source title',
      format: 'epub',
      size: 3,
      updatedAt: '2026-01-01',
    } as unknown as ReaderBookSummary)
  })

  test('a media book is named by its upload and keys its media id', () => {
    const book = bookFromMedia('m1', ' Novel.epub ', parsed('Author'), previous, 4)
    expect(Object.keys(book)).toEqual([
      'path',
      'mediaId',
      'title',
      'author',
      'sourceTitle',
      'sourceAuthor',
      'overrides',
      'collectionIds',
      'format',
      'size',
      'updatedAt',
    ])
    expect(book).toMatchObject({ path: 'Novel.epub', mediaId: 'm1', title: 'Mine', size: 4 })
    expect(bookFromMedia('m2', undefined, parsed(), undefined, 1).path).toBe('m2')
  })
})
