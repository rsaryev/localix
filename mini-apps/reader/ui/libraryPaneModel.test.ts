import { describe, expect, test } from 'bun:test'

import type { ReaderBookSummary, ReaderLibraryResponse } from '../shared/contracts'
import {
  bookFormatLine,
  bookOnShelf,
  filterLibraryBooks,
  filterSavedQuotes,
  libraryGridKeyIndex,
  readLibrarySort,
  replaceLibraryBooks,
  shelfLabel,
  toggleKey,
  toggleShelfSelection,
  withoutLibraryBooks,
  withoutLibraryCollection,
} from './libraryPaneModel'
import type { ReaderSavedQuote } from './model'
import { readerBookKey } from './readerSources'

const book = (path: string, extra: Partial<ReaderBookSummary> = {}): ReaderBookSummary => ({
  path,
  title: path.replace(/\..*$/u, ''),
  format: 'epub',
  size: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

const dune = book('dune.epub', { author: 'Herbert', collectionIds: ['sf'] })
const emma = book('emma.epub', { author: 'Austen' })
const library: ReaderLibraryResponse = {
  books: [dune, emma],
  collections: [{ id: 'sf', name: 'Science fiction', createdAt: '2026-01-01T00:00:00.000Z' }],
} as ReaderLibraryResponse

describe('library pane model', () => {
  test('accepts only known stored sorts', () => {
    expect(readLibrarySort('title')).toBe('title')
    expect(readLibrarySort('nonsense')).toBe('recent')
    expect(readLibrarySort(null)).toBe('recent')
  })

  test('filters books by shelf and by title, author or path', () => {
    expect(bookOnShelf(dune, { kind: 'unfiled' })).toBe(false)
    expect(bookOnShelf(emma, { kind: 'unfiled' })).toBe(true)
    expect(bookOnShelf(emma, { kind: 'collection', id: 'sf' })).toBe(false)
    expect(filterLibraryBooks(library.books, { kind: 'all' }, ' austen ')).toEqual([emma])
    expect(filterLibraryBooks(library.books, { kind: 'collection', id: 'sf' }, '')).toEqual([dune])
    expect(filterLibraryBooks(library.books, { kind: 'all' }, 'dune.ep')).toEqual([dune])
  })

  test('filters saved annotations by book, chapter or quote', () => {
    const quote = {
      id: 'q',
      bookTitle: 'Dune',
      chapterTitle: 'Arrakis',
      quote: 'Fear is the mind-killer',
    } as ReaderSavedQuote
    expect(filterSavedQuotes([quote], 'MIND')).toEqual([quote])
    expect(filterSavedQuotes([quote], 'arrakis')).toEqual([quote])
    expect(filterSavedQuotes([quote], 'emma')).toEqual([])
  })

  test('labels the shelf, falling back to all books for a vanished collection', () => {
    expect(shelfLabel({ kind: 'all' }, library.collections)).toBe('All books')
    expect(shelfLabel({ kind: 'unfiled' }, library.collections)).toBe('Unfiled')
    expect(shelfLabel({ kind: 'collection', id: 'sf' }, library.collections)).toBe(
      'Science fiction',
    )
    expect(shelfLabel({ kind: 'collection', id: 'gone' }, library.collections)).toBe('All books')
  })

  test('describes a book format with its collection count', () => {
    expect(bookFormatLine(emma)).toBe('EPUB')
    expect(bookFormatLine(dune)).toBe('EPUB · 1 collection')
    expect(bookFormatLine(book('x.pdf', { format: 'pdf', collectionIds: ['a', 'b'] }))).toBe(
      'PDF · 2 collections',
    )
  })

  test('toggles single keys and whole shelves', () => {
    expect([...toggleKey(new Set(['a']), 'a')]).toEqual([])
    expect([...toggleKey(new Set(['a']), 'b')]).toEqual(['a', 'b'])
    expect([...toggleShelfSelection(new Set(['a']), ['a', 'b'])].sort()).toEqual(['a', 'b'])
    expect([...toggleShelfSelection(new Set(['a', 'b', 'c']), ['a', 'b'])]).toEqual(['c'])
  })

  test('rewrites the library after edits without touching other entries', () => {
    const renamed = { ...dune, title: 'Dune (1965)' }
    expect(replaceLibraryBooks(library, [renamed])?.books).toEqual([renamed, emma])
    expect(withoutLibraryBooks(library, new Set([readerBookKey(emma)]))?.books).toEqual([dune])
    const unshelved = withoutLibraryCollection(library, 'sf')
    expect(unshelved?.collections).toEqual([])
    expect(unshelved?.books[0]?.collectionIds).toEqual([])
    expect(replaceLibraryBooks(null, [dune])).toBeNull()
  })

  test('moves grid focus by reading order and by nearest card on the next row', () => {
    // Two rows of three: (0,1,2) at y=0 and (3,4) at y=100.
    const centres = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]
    expect(libraryGridKeyIndex('Home', 3, centres)).toBe(0)
    expect(libraryGridKeyIndex('End', 0, centres)).toBe(4)
    expect(libraryGridKeyIndex('ArrowRight', 1, centres)).toBe(2)
    expect(libraryGridKeyIndex('ArrowDown', 1, centres)).toBe(4)
    expect(libraryGridKeyIndex('ArrowDown', 2, centres)).toBe(4)
    expect(libraryGridKeyIndex('ArrowUp', 3, centres)).toBe(0)
    expect(libraryGridKeyIndex('ArrowDown', 4, centres)).toBe(4)
    expect(libraryGridKeyIndex('Enter', 0, centres)).toBeNull()
  })
})
