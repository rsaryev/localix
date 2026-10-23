import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { TabBar } from '@localixai/kit/tabs'
import { CATEGORY_LABELS } from '../model/categories'
import {
  ALL,
  countBySource,
  filterEntries,
  NO_FILTER,
  type StoreFilter,
} from '../model/storeFilters'
import type {
  LoadStorePage,
  StoreActions,
  StoreCatalogs,
  StoreDesktopApps,
} from '../model/storeActions'
import { backendClient } from '@/shared/api/client'
import { useDesktopAfterInstall } from '../model/useDesktopAfterInstall'
import { useMiniAppCatalogs } from '../model/useMiniAppCatalogs'
import { useMiniAppStore } from '../model/useMiniAppStore'
import { AddCatalogDialog } from './AddCatalogDialog'
import { CatalogSelector } from './CatalogSelector'
import { MiniAppStoreDetail } from './MiniAppStoreDetail'
import { MiniAppStoreList } from './MiniAppStoreList'
import { TagFilterChip } from './TagButton'

const NO_PROBLEMS: string[] = []

/** The element that scrolls the store, so leaving an app's page returns to where the list was. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

export interface MiniAppStoreViewProps extends StoreActions {
  entries: MiniAppStoreEntryRecord[]
  problems?: string[]
  loading: boolean
  loadPage: LoadStorePage
  catalogs: StoreCatalogs
  /** Where a desktop app can be made; absent elsewhere. */
  desktop?: StoreDesktopApps
  /** A catalog a `localix://` link asked to add: the dialog opens with it, waiting for a yes. */
  addCatalogUrl?: string
}

/**
 * The store: categories as tabs with the tag filter, the search and the catalog menu beside them,
 * then the apps — featured first — one row each. A row opens the app's page in place; Back returns
 * to the list with its filters and scroll kept. One component for the store tab, Settings and the
 * first run, so they cannot drift.
 */
export function MiniAppStoreView({
  entries,
  problems = NO_PROBLEMS,
  loading,
  loadPage,
  catalogs,
  desktop,
  addCatalogUrl,
  ...actions
}: MiniAppStoreViewProps) {
  const [filter, setFilter] = useState<StoreFilter>(NO_FILTER)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(Boolean(addCatalogUrl))
  const root = useRef<HTMLDivElement>(null)
  const listScroll = useRef(0)
  const returnTo = useRef<string | null>(null)
  const desktopAfter = useDesktopAfterInstall(entries, desktop)

  // A new link to add a catalog opens the dialog again, even over an earlier one.
  const [linkedUrl, setLinkedUrl] = useState(addCatalogUrl)
  if (addCatalogUrl !== linkedUrl) {
    setLinkedUrl(addCatalogUrl)
    if (addCatalogUrl) setAdding(true)
  }

  // Back on the list: where it was scrolled to, and focus on the row that was opened.
  useLayoutEffect(() => {
    if (open || !returnTo.current) return
    const scroller = scrollParent(root.current)
    if (scroller) scroller.scrollTop = listScroll.current
    root.current
      ?.querySelector<HTMLButtonElement>(
        `[data-mini-app="${CSS.escape(returnTo.current)}"] > button`,
      )
      ?.focus()
    returnTo.current = null
  }, [open])

  const categories = useMemo(
    () => [...new Set(entries.flatMap((entry) => (entry.category ? [entry.category] : [])))].sort(),
    [entries],
  )
  const counts = useMemo(() => countBySource(entries), [entries])
  const set = (patch: Partial<StoreFilter>) => setFilter((current) => ({ ...current, ...patch }))
  const openApp = (name: string) => {
    listScroll.current = scrollParent(root.current)?.scrollTop ?? 0
    setOpen(name)
  }
  const back = () => {
    returnTo.current = open
    setOpen(null)
  }
  const withDesktop = (entry: MiniAppStoreEntryRecord) =>
    desktop?.available(entry)
      ? (opts: { acceptUnverified?: boolean }) => {
          desktopAfter.afterInstall(entry.name)
          actions.onInstall(entry.name, opts)
        }
      : undefined

  const dialog = (
    <AddCatalogDialog
      open={adding}
      initialUrl={addCatalogUrl}
      catalogs={catalogs}
      onOpenChange={setAdding}
    />
  )
  const problemLines = problems.map((problem) => (
    <p key={problem} className="px-2 text-xs text-status-warning">
      {problem}
    </p>
  ))

  const opened = open ? entries.find((entry) => entry.name === open) : undefined
  if (opened) {
    const title = opened.displayName ?? opened.name
    return (
      <div ref={root} className="@container">
        <MiniAppStoreDetail
          entry={opened}
          loadPage={loadPage}
          onBack={back}
          onTag={(tag) => {
            set({ tag })
            back()
          }}
          onInstallWithDesktop={withDesktop(opened)}
          desktopApp={
            desktop?.available(opened)
              ? {
                  has: desktop.has(opened.name),
                  add: () => desktopAfter.make(opened.name, title),
                  remove: () => void desktop.remove(opened.name),
                }
              : undefined
          }
          desktopProblem={desktopAfter.problems[opened.name]}
          {...actions}
        />
        {dialog}
      </div>
    )
  }

  if (loading && entries.length === 0) return <LoadingHint>Loading the catalog…</LoadingHint>
  return (
    <div ref={root} className="flex min-w-0 flex-col gap-4">
      <TabBar
        aria-label="Mini app categories"
        items={[
          { id: ALL, label: 'All' },
          ...categories.map((id) => ({ id, label: CATEGORY_LABELS[id] ?? id })),
        ]}
        active={filter.category}
        onChange={(category) => set({ category })}
        trailing={
          <div className="flex items-center gap-2">
            {filter.tag && <TagFilterChip tag={filter.tag} onClear={() => set({ tag: null })} />}
            <SearchInput
              value={filter.query}
              onValueChange={(query) => set({ query })}
              placeholder="Search"
              aria-label="Search mini apps"
              size="md"
              className="w-48"
            />
            <CatalogSelector
              catalogs={catalogs.list}
              counts={counts}
              active={filter.source}
              onChoose={(source) => set({ source })}
              onRemove={(url) => {
                if (filter.source === url) set({ source: null })
                void catalogs.remove(url)
              }}
              onAdd={() => setAdding(true)}
            />
          </div>
        }
      />
      {problemLines}
      {entries.length === 0 ? (
        <EmptyHint>No catalog offers a mini app yet.</EmptyHint>
      ) : (
        <MiniAppStoreList
          shown={filterEntries(entries, filter)}
          onOpen={openApp}
          onTag={(tag) => set({ tag })}
          withDesktop={withDesktop}
          desktopProblems={desktopAfter.problems}
          {...actions}
        />
      )}
      {dialog}
    </div>
  )
}

/**
 * The store, live: read from the server and re-read on every install and catalog poke. The page
 * that shows it hands in the desktop apps it can offer and a catalog a link asked to add.
 */
export function MiniAppStore({
  desktop,
  addCatalogUrl,
}: {
  desktop?: StoreDesktopApps
  addCatalogUrl?: string
}) {
  const { entries, problems, loading, install, remove } = useMiniAppStore()
  const catalogs = useMiniAppCatalogs()
  return (
    <div className="@container">
      <MiniAppStoreView
        entries={entries}
        problems={problems}
        loading={loading}
        loadPage={(name) => backendClient.getMiniAppStorePage(name)}
        catalogs={catalogs}
        desktop={desktop}
        addCatalogUrl={addCatalogUrl}
        onInstall={(name, opts) => void install(name, opts)}
        onRemove={(name) => void remove(name)}
      />
    </div>
  )
}
