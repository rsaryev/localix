import { useEffect, useMemo, useState } from 'react'
import { docPages, loadAllDocContent } from '@/generated/docs'

export interface DocSearch {
  query: string
  setQuery: (value: string) => void
  /** Lowercased and trimmed; empty means "not searching". */
  normalizedQuery: string
  /** Pages matching the query, or every page when not searching. */
  filtered: typeof docPages
  /** Full-text bodies, once fetched. `null` while the first query is still loading. */
  loadedContent: ReadonlyMap<string, string> | null
  /** The bodies could not be fetched; titles and summaries still match. */
  failed: boolean
}

/**
 * Titles and summaries are in the initial bundle, so they match immediately.
 * The page bodies are not: they are fetched once, lazily, the first time
 * someone actually types — a visitor who never searches never pays for them.
 */
export function useDocSearch(): DocSearch {
  const [query, setQuery] = useState('')
  const [loadedContent, setLoadedContent] = useState<ReadonlyMap<string, string> | null>(null)
  const [failed, setFailed] = useState(false)
  const normalizedQuery = query.trim().toLowerCase()

  useEffect(() => {
    if (!normalizedQuery || loadedContent || failed) return
    let current = true
    void loadAllDocContent().then(
      (content) => {
        if (current) setLoadedContent(content)
      },
      () => {
        if (current) setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [normalizedQuery, loadedContent, failed])

  const filtered = useMemo(() => {
    if (!normalizedQuery) return docPages
    return docPages.filter(
      (page) =>
        page.title.toLowerCase().includes(normalizedQuery) ||
        page.summary.toLowerCase().includes(normalizedQuery) ||
        (loadedContent?.get(page.slug)?.toLowerCase().includes(normalizedQuery) ?? false),
    )
  }, [normalizedQuery, loadedContent])

  return { query, setQuery, normalizedQuery, filtered, loadedContent, failed }
}
