import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReaderBookSummary, ReaderLibraryResponse } from '../shared/contracts'
import { useStoreChanges } from '@localixai/mini-app-sdk/ui/store-resource'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
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

  const refresh = useCallback(() => {
    const request = ++requestRef.current
    return new Promise<ReaderLibraryResponse>((resolve) => resolve(loadLibrary())).then(
      (library) => {
        if (request !== requestRef.current) return false
        setBooks(library.books)
        return true
      },
      () => false,
    )
  }, [loadLibrary])

  useEffect(() => {
    if (refreshKey === null) return
    void refresh()
    return () => {
      requestRef.current += 1
    }
  }, [refresh, refreshKey])

  const live = useStoreChanges(
    { miniApp: 'reader', sessionId: null },
    () => void refresh(),
    refreshKey !== null,
  )
  useVisiblePolling({ enabled: refreshKey !== null && !live, intervalMs: 60_000, onTick: refresh })
  return { books, refresh }
}
