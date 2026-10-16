import { useMemo } from 'react'

import type { ReaderDocument, ReaderSource } from '../shared/contracts'
import { sourceForBook, sourceStorageKey } from './readerSources'
import { useReaderLibraryBooks } from './useReaderLibraryBooks'

/** The pane's source, its storage key, and how the open book is titled from the library. */
export function useReaderBookIdentity({
  path,
  mediaId,
  name,
}: {
  path?: string
  mediaId?: string
  name?: string
}) {
  const source = useMemo<ReaderSource>(
    () => (path ? { path } : { mediaId: mediaId!, ...(name ? { name } : {}) }),
    [mediaId, name, path],
  )
  return { source, sourceKey: path ?? `media:${mediaId}` }
}

/** The library entry for the open book, which outranks the parsed title and author. */
export function useReaderBookTitle({
  sourceKey,
  document,
  name,
}: {
  sourceKey: string
  document: ReaderDocument | null
  name?: string
}) {
  const { books: libraryBooks, refresh: refreshLibraryBooks } = useReaderLibraryBooks(
    document ? sourceKey : null,
  )
  const currentBook = useMemo(
    () => libraryBooks.find((book) => sourceStorageKey(sourceForBook(book)) === sourceKey),
    [libraryBooks, sourceKey],
  )
  return {
    libraryBooks,
    refreshLibraryBooks,
    currentBook,
    displayBookTitle: currentBook?.title ?? document?.title ?? name ?? 'Book',
    displayBookAuthor: currentBook?.author ?? document?.author,
  }
}
