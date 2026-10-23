import { useMemo, useState } from 'react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { TabBar } from '@localixai/kit/tabs'
import { CATEGORY_LABELS } from '../model/categories'
import { useMiniAppStore } from '../model/useMiniAppStore'
import { MiniAppStoreRow, type StoreActions } from './MiniAppStoreRow'

/** The words a search matches: name, display name, description and publisher. */
const haystack = (entry: MiniAppStoreEntryRecord) =>
  [entry.name, entry.displayName, entry.description, entry.publisher.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

const busy = (entry: MiniAppStoreEntryRecord) =>
  ['queued', 'downloading', 'installing'].includes(entry.job?.phase ?? '')

/** Which group an app is in: one that wants an update, one already here, or one to add. */
function groupOf(entry: MiniAppStoreEntryRecord): 'updates' | 'installed' | 'available' {
  if (entry.update && !entry.incompatible) return 'updates'
  if (entry.installed && !busy(entry)) return 'installed'
  return 'available'
}

const GROUPS = [
  { id: 'updates', title: 'Updates' },
  { id: 'installed', title: 'Installed' },
  { id: 'available', title: 'Available' },
] as const

const ALL = 'all'
const NO_PROBLEMS: string[] = []

/**
 * The store: categories as tabs with the search beside them, then the apps in three groups —
 * updates, installed, available — one row each. Shown in its own workspace tab, in Settings →
 * Mini apps and on the first run; one component, so they cannot drift.
 */
export function MiniAppStoreView({
  entries,
  problems = NO_PROBLEMS,
  loading,
  ...actions
}: {
  entries: MiniAppStoreEntryRecord[]
  problems?: string[]
  loading: boolean
} & StoreActions) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const categories = useMemo(
    () => [...new Set(entries.flatMap((entry) => (entry.category ? [entry.category] : [])))].sort(),
    [entries],
  )
  const needle = query.trim().toLowerCase()
  const shown = entries.filter(
    (entry) =>
      (category === ALL || entry.category === category) &&
      (!needle || haystack(entry).includes(needle)),
  )
  const problemLines = problems.map((problem) => (
    <p key={problem} className="px-2 text-xs text-status-warning">
      {problem}
    </p>
  ))
  if (loading && entries.length === 0) return <LoadingHint>Loading the catalog…</LoadingHint>
  if (entries.length === 0)
    return (
      <div className="flex flex-col gap-2">
        {problemLines}
        <EmptyHint>No catalog offers a mini app yet.</EmptyHint>
      </div>
    )
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TabBar
        aria-label="Mini app categories"
        items={[
          { id: ALL, label: 'All' },
          ...categories.map((id) => ({ id, label: CATEGORY_LABELS[id] ?? id })),
        ]}
        active={category}
        onChange={setCategory}
        trailing={
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search"
            aria-label="Search mini apps"
            size="md"
            className="w-48"
          />
        }
      />
      {problemLines}
      {shown.length === 0 ? (
        <EmptyHint>Nothing matches.</EmptyHint>
      ) : (
        GROUPS.map(({ id, title }) => {
          const rows = shown.filter((entry) => groupOf(entry) === id)
          if (rows.length === 0) return null
          return (
            <section key={id} className="flex flex-col gap-1">
              <h2 className="px-2 text-xs font-medium text-text-soft">
                {title} <span className="text-text-faint tabular-nums">{rows.length}</span>
              </h2>
              <ul className="grid grid-cols-1 gap-x-4 @3xl:grid-cols-2">
                {rows.map((entry) => (
                  <MiniAppStoreRow key={entry.name} entry={entry} {...actions} />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}

/** The store, live: read from the server and re-read on every install poke. */
export function MiniAppStore() {
  const { entries, problems, loading, install, remove } = useMiniAppStore()
  return (
    <div className="@container">
      <MiniAppStoreView
        entries={entries}
        problems={problems}
        loading={loading}
        onInstall={(name, opts) => void install(name, opts)}
        onRemove={(name) => void remove(name)}
      />
    </div>
  )
}
