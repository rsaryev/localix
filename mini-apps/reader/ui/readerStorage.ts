import { useState } from 'react'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'

import {
  normalizeReaderPreferences,
  normalizeReaderSavedQuote,
  upsertReaderSavedQuote,
  type ReaderBookmark,
  type ReaderPreferences,
  type ReaderSavedQuote,
} from './model'

/**
 * Everything the Reader keeps in this browser: preferences, saved quotes, bookmarks, and the
 * per-book progress key.
 *
 * Split out of `ReaderWorkspace.tsx` — 4,386 lines, the largest file in the repository — where
 * these hooks sat above two thousand-line panes that do not use most of them. They belong
 * together and apart: one storage version prefix, one place to look when a stored shape changes,
 * and nothing here renders.
 *
 * `localStorage` rather than the backend on purpose: which typeface you read at is about this
 * machine, and a reading position that needed a round-trip would lag the scroll that produced it.
 */
const PREFERENCES_KEY = 'reader:preferences:v1'
export const QUOTES_KEY = 'reader:quotes:v1'
const BOOKMARKS_KEY = 'reader:bookmarks:v1'
export const LIBRARY_SORT_KEY = 'reader:library-sort:v1'
export const progressKey = (path: string) => `reader:progress:v1:${path}`

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230))
}

export function useReaderPreferences() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(() =>
    normalizeReaderPreferences(loadJSON<Partial<ReaderPreferences>>(PREFERENCES_KEY)),
  )
  const update = (next: ReaderPreferences) => {
    setPreferences(next)
    saveJSON(PREFERENCES_KEY, next)
  }
  return [preferences, update] as const
}

export function useSavedQuotes(path: string | null) {
  const [all, setAll] = useState<ReaderSavedQuote[]>(() =>
    (loadJSON<ReaderSavedQuote[]>(QUOTES_KEY) ?? []).map(normalizeReaderSavedQuote),
  )
  const allRef = useLatest(all)
  const commit = (next: ReaderSavedQuote[]) => {
    allRef.current = next
    setAll(next)
    saveJSON(QUOTES_KEY, next)
  }
  const save = (quote: ReaderSavedQuote): string => {
    const result = upsertReaderSavedQuote(allRef.current, quote)
    commit(result.items)
    return result.id
  }
  const update = (id: string, patch: Partial<Pick<ReaderSavedQuote, 'color' | 'note'>>) => {
    const next = allRef.current.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
    )
    commit(next)
  }
  const remove = (id: string) => {
    commit(allRef.current.filter((item) => item.id !== id))
  }
  const importMany = (quotes: ReaderSavedQuote[]) => {
    let current = allRef.current
    let added = 0
    let updated = 0
    for (const quote of quotes) {
      const before = current.length
      const result = upsertReaderSavedQuote(current, quote)
      current = result.items
      if (current.length > before) added += 1
      else updated += 1
    }
    commit(current)
    return { added, updated }
  }
  return {
    quotes: path ? all.filter((item) => item.path === path) : [],
    save,
    update,
    remove,
    importMany,
  }
}

export function useBookmarks(path: string | null) {
  const [all, setAll] = useState<ReaderBookmark[]>(
    () => loadJSON<ReaderBookmark[]>(BOOKMARKS_KEY) ?? [],
  )
  const toggle = (bookmark: ReaderBookmark) => {
    const exists = all.some(
      (item) => item.path === bookmark.path && item.chapter === bookmark.chapter,
    )
    const next = exists
      ? all.filter((item) => !(item.path === bookmark.path && item.chapter === bookmark.chapter))
      : [bookmark, ...all].slice(0, 500)
    setAll(next)
    saveJSON(BOOKMARKS_KEY, next)
  }
  const remove = (id: string) => {
    const next = all.filter((item) => item.id !== id)
    setAll(next)
    saveJSON(BOOKMARKS_KEY, next)
  }
  return {
    bookmarks: path ? all.filter((item) => item.path === path) : [],
    toggle,
    remove,
  }
}
