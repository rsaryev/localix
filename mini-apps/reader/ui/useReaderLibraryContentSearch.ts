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
  const value = query.trim()
  const active = enabled && value.length >= 2
  // What the last finished search answered, and for which text. Loading is "the text in the box
  // is not the text last answered", so nothing is set while the box changes.
  const [answer, setAnswer] = useState<{
    value: string
    response: ReaderLibrarySearchResponse | null
  } | null>(null)
  // Leaving the search (a short query, another view) forgets its answer.
  if (!active && answer) setAnswer(null)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void readerApi.searchLibrary(value, controller.signal).then(
        (response) => {
          if (!controller.signal.aborted) setAnswer({ value, response })
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ value, response: null })
        },
      )
    }, LIBRARY_CONTENT_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [active, value])

  return {
    contentSearch: active ? (answer?.response ?? null) : null,
    contentSearchLoading: active && answer?.value !== value,
  }
}
