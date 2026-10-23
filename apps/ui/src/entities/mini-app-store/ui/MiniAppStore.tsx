import { useMemo, useState } from 'react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { CATEGORY_LABELS } from '../model/categories'
import { useMiniAppStore } from '../model/useMiniAppStore'
import { MiniAppStoreCard } from './MiniAppStoreCard'

/** The words a search matches: name, display name, description and publisher. */
const haystack = (entry: MiniAppStoreEntryRecord) =>
  [entry.name, entry.displayName, entry.description, entry.publisher.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

/**
 * The store as cards: a search, the categories the catalogs use, and one card per app. Shown in
 * Settings → Mini apps, behind the rail's add button and on the first run — one component, so the
 * three cannot drift.
 */
export function MiniAppStoreView({
  entries,
  loading,
  onInstall,
}: {
  entries: MiniAppStoreEntryRecord[]
  loading: boolean
  onInstall: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const categories = useMemo(
    () => [...new Set(entries.flatMap((entry) => (entry.category ? [entry.category] : [])))].sort(),
    [entries],
  )
  const shown = entries.filter(
    (entry) =>
      (!category || entry.category === category) &&
      (!query.trim() || haystack(entry).includes(query.trim().toLowerCase())),
  )
  if (loading && entries.length === 0) return <LoadingHint>Loading the catalog…</LoadingHint>
  if (entries.length === 0) return <EmptyHint>No catalog offers a mini app yet.</EmptyHint>
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search mini apps…"
          aria-label="Search mini apps"
          size="md"
          className="w-56"
        />
        <div className="flex flex-wrap items-center gap-1">
          <TogglePill active={category === null} onClick={() => setCategory(null)}>
            All
          </TogglePill>
          {categories.map((id) => (
            <TogglePill key={id} active={category === id} onClick={() => setCategory(id)}>
              {CATEGORY_LABELS[id] ?? id}
            </TogglePill>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyHint>Nothing matches.</EmptyHint>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {shown.map((entry) => (
            <MiniAppStoreCard key={entry.name} entry={entry} onInstall={onInstall} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** The store, live: read from the server and re-read on every install poke. */
export function MiniAppStore() {
  const { entries, loading, install } = useMiniAppStore()
  return (
    <MiniAppStoreView
      entries={entries}
      loading={loading}
      onInstall={(name) => void install(name)}
    />
  )
}
