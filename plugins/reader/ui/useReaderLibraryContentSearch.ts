import { useEffect, useState } from 'react'

import type { ReaderLibrarySearchResponse } from '../shared/contracts'
import { readerApi } from './api'
import { LIBRARY_CONTENT_SEARCH_DEBOUNCE_MS } from './libraryPaneModel'

/** Debounced full-text search across book contents while the gallery is browsed by query. */
export function useReaderLibraryContentSearch({
  query,
  enabled,
}: {
  query: string
  /** The books view, outside selection mode. */
  enabled: boolean
}) {
  const [contentSearch, setContentSearch] = useState<ReaderLibrarySearchResponse | null>(null)
  const [contentSearchLoading, setContentSearchLoading] = useState(false)

  useEffect(() => {
    const value = query.trim()
    if (!enabled || value.length < 2) {
      setContentSearch(null)
      setContentSearchLoading(false)
      return
    }
    const controller = new AbortController()
    setContentSearchLoading(true)
    const timer = window.setTimeout(() => {
      void readerApi
        .searchLibrary(value, controller.signal)
        .then((next) => setContentSearch(next))
        .catch(() => !controller.signal.aborted && setContentSearch(null))
        .finally(() => !controller.signal.aborted && setContentSearchLoading(false))
    }, LIBRARY_CONTENT_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, query])

  return { contentSearch, contentSearchLoading }
}
