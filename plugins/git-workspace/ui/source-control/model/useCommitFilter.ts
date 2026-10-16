import { useEffect, useState } from 'react'
import type { LogFilter } from '../../../backend/source-control/contracts'

export interface CommitFilterState {
  query: string
  author: string
  path: string
  setQuery: (value: string) => void
  setAuthor: (value: string) => void
  setPath: (value: string) => void
  /** The debounced filter that actually drives the `git log` read. */
  active: LogFilter
  /** The author/path popover has a value (the message query is always visible). */
  advancedActive: boolean
  hasFilter: boolean
  clear: () => void
}

/** Wait this long after the last keystroke before re-reading the log. */
const DEBOUNCE_MS = 250

/**
 * The commit graph's filter inputs, debounced into the `LogFilter` that drives `git log
 * --grep/--author/-- <path>`: every keystroke used to be a log read.
 */
export function useCommitFilter(): CommitFilterState {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [path, setPath] = useState('')
  const [active, setActive] = useState<LogFilter>({})

  useEffect(() => {
    const t = setTimeout(() => {
      setActive({
        query: query.trim() || undefined,
        author: author.trim() || undefined,
        path: path.trim() || undefined,
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, author, path])

  return {
    query,
    author,
    path,
    setQuery,
    setAuthor,
    setPath,
    active,
    advancedActive: author.trim().length > 0 || path.trim().length > 0,
    hasFilter: Boolean(active.query || active.author || active.path),
    clear: () => {
      setQuery('')
      setAuthor('')
      setPath('')
    },
  }
}
