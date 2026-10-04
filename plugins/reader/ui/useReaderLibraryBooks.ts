import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReaderBookSummary, ReaderLibraryResponse } from '../shared/contracts'
import { readerApi } from './api'

export type ReaderLibraryLoader = () => Promise<ReaderLibraryResponse>

/**
 * Module-level so the default loader keeps one identity across renders — an inline
 * default would re-run the revalidation effect on every render.
 */
const loadReaderLibrary: ReaderLibraryLoader = () => readerApi.library()

/**
 * Keeps a Reader shelf snapshot fresh without letting an older response overwrite a
 * newer one. Revalidation failures intentionally preserve the last usable shelf.
 */
export function useReaderLibraryBooks(
  refreshKey: string | null,
  loadLibrary: ReaderLibraryLoader = loadReaderLibrary,
): { books: ReaderBookSummary[]; refresh: () => Promise<boolean> } {
  const [books, setBooks] = useState<ReaderBookSummary[]>([])
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const library = await loadLibrary()
      if (request !== requestRef.current) return false
      setBooks(library.books)
      return true
    } catch {
      return false
    }
  }, [loadLibrary])

  useEffect(() => {
    if (refreshKey === null) return
    void refresh()
    return () => {
      requestRef.current += 1
    }
  }, [refresh, refreshKey])

  return { books, refresh }
}
