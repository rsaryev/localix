import type {
  ReaderBookSummary,
  ReaderCollection,
  ReaderLibraryResponse,
  ReaderLibrarySearchResponse,
} from '../shared/contracts'
import type { ReaderLibrarySort, ReaderSavedQuote } from './model'
import type { ReaderShelfFilter } from './readerParts'
import { readerBookKey } from './readerSources'

/** Pure helpers behind the library pane, kept apart from React so they can be tested directly. */

/** How long the library waits after typing before searching book contents. */
export const LIBRARY_CONTENT_SEARCH_DEBOUNCE_MS = 240
/** How often the library re-reads itself when no live store feed is available. */
export const LIBRARY_POLL_INTERVAL_MS = 60_000

export function readLibrarySort(stored: unknown): ReaderLibrarySort {
  return stored === 'title' || stored === 'progress' || stored === 'format' ? stored : 'recent'
}

export function bookOnShelf(
  book: Pick<ReaderBookSummary, 'collectionIds'>,
  shelf: ReaderShelfFilter,
): boolean {
  if (shelf.kind === 'all') return true
  if (shelf.kind === 'unfiled') return (book.collectionIds?.length ?? 0) === 0
  return Boolean(book.collectionIds?.includes(shelf.id))
}

/** Books on the shelf whose title, author or path contains the query. */
export function filterLibraryBooks(
  books: ReaderBookSummary[],
  shelf: ReaderShelfFilter,
  query: string,
): ReaderBookSummary[] {
  const needle = query.trim().toLocaleLowerCase()
  return books.filter(
    (book) =>
      bookOnShelf(book, shelf) &&
      (!needle ||
        `${book.title}\n${book.author ?? ''}\n${book.path}`.toLocaleLowerCase().includes(needle)),
  )
}

export function filterContentSearch(
  search: ReaderLibrarySearchResponse | null,
  shelf: ReaderShelfFilter,
): ReaderLibrarySearchResponse | null {
  if (!search || shelf.kind === 'all') return search
  return { ...search, hits: search.hits.filter(({ book }) => bookOnShelf(book, shelf)) }
}

export function filterSavedQuotes(saved: ReaderSavedQuote[], query: string): ReaderSavedQuote[] {
  const needle = query.trim().toLocaleLowerCase()
  return saved.filter(
    (item) =>
      !needle ||
      `${item.bookTitle ?? ''}\n${item.chapterTitle}\n${item.quote}`
        .toLocaleLowerCase()
        .includes(needle),
  )
}

export function shelfLabel(shelf: ReaderShelfFilter, collections: ReaderCollection[]): string {
  if (shelf.kind === 'all') return 'All books'
  if (shelf.kind === 'unfiled') return 'Unfiled'
  return collections.find((collection) => collection.id === shelf.id)?.name ?? 'All books'
}

/** The format line under a cover: `EPUB · 2 collections`. */
export function bookFormatLine(book: ReaderBookSummary): string {
  const count = book.collectionIds?.length ?? 0
  const collections = count > 0 ? ` · ${count} ${count === 1 ? 'collection' : 'collections'}` : ''
  return `${book.format.toUpperCase()}${collections}`
}

export function toggleKey(keys: Set<string>, key: string): Set<string> {
  const next = new Set(keys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** Selects every visible key, or clears them all when every one is already selected. */
export function toggleShelfSelection(keys: Set<string>, visibleKeys: string[]): Set<string> {
  const allVisibleSelected = visibleKeys.every((key) => keys.has(key))
  const next = new Set(keys)
  for (const key of visibleKeys) {
    if (allVisibleSelected) next.delete(key)
    else next.add(key)
  }
  return next
}

export function replaceLibraryBooks(
  library: ReaderLibraryResponse | null,
  updated: ReaderBookSummary[],
): ReaderLibraryResponse | null {
  if (!library) return library
  const byKey = new Map(updated.map((book) => [readerBookKey(book), book]))
  return { ...library, books: library.books.map((book) => byKey.get(readerBookKey(book)) ?? book) }
}

export function withoutLibraryBooks(
  library: ReaderLibraryResponse | null,
  removedKeys: Set<string>,
): ReaderLibraryResponse | null {
  if (!library) return library
  return {
    ...library,
    books: library.books.filter((book) => !removedKeys.has(readerBookKey(book))),
  }
}

export function withoutLibraryCollection(
  library: ReaderLibraryResponse | null,
  id: string,
): ReaderLibraryResponse | null {
  if (!library) return library
  return {
    books: library.books.map((book) => ({
      ...book,
      collectionIds: (book.collectionIds ?? []).filter((value) => value !== id),
    })),
    collections: library.collections.filter((collection) => collection.id !== id),
  }
}

export interface LibraryGridPoint {
  x: number
  y: number
}

/**
 * The card a grid key moves to. Left/Right step through reading order; Up/Down pick the nearest
 * card on another row, weighting vertical distance so a row change wins over a long sideways hop.
 * Returns null for keys the grid does not handle.
 */
export function libraryGridKeyIndex(
  key: string,
  currentIndex: number,
  centres: LibraryGridPoint[],
): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return centres.length - 1
  if (key === 'ArrowLeft') return currentIndex - 1
  if (key === 'ArrowRight') return currentIndex + 1
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  const current = centres[currentIndex]
  if (!current) return currentIndex
  const direction = key === 'ArrowUp' ? -1 : 1
  const candidate = centres
    .map((point, index) => ({
      index,
      forward: (point.y - current.y) * direction > 1,
      distance: Math.abs(point.y - current.y) * 4 + Math.abs(point.x - current.x),
    }))
    .filter((item) => item.forward)
    .sort((left, right) => left.distance - right.distance)[0]
  return candidate ? candidate.index : currentIndex
}
