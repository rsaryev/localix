import { useStoreChanges } from '@localixai/plugin-sdk/ui/store-resource'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { useFocusEntry } from '@localixai/plugin-sdk/ui/focus'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  ArrowUpDown,
  BookMarked,
  BookOpen,
  Ellipsis,
  Folder,
  Grid2X2,
  Library,
  ListChecks,
  NotebookPen,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import {
  acknowledgeInline,
  createMessageBindingDraft,
  resourceMessageBindingDraft,
  runPluginAction,
  toast,
} from '@localixai/plugin-sdk/ui'
import { setMessageBindingDrag } from '@localixai/plugin-sdk/ui/message-binding-drag'
import { pluginFiles, pluginNavigation } from '@localixai/plugin-sdk/ui/runtime'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { SearchInput } from '@localixai/kit/search-input'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

import type {
  ReaderBookSummary,
  ReaderCollection,
  ReaderLibraryResponse,
  ReaderLibrarySearchResponse,
  ReaderSource,
} from '../shared/contracts'
import { READER_EXTENSIONS, readerFileName, readerUnsupportedReason } from '../shared/formats'
import { readerBookUri } from '../shared/resource-uri'
import { readerApi } from './api'
import {
  normalizeReaderSavedQuote,
  sortReaderBooks,
  type ReaderLibrarySort,
  type ReaderSavedQuote,
  type ReaderTextTarget,
} from './model'
import { ReaderCollectionsDialog, ReaderMetadataDialog } from './ReaderLibraryDialogs'
import { ReaderHighlightSwatch } from './ReaderSelectionToolbar'
import { LIBRARY_SORT_KEY, QUOTES_KEY } from './readerStorage'
import {
  readerBookKey,
  sourceForBook,
  sourceFromSaved,
  storedBookProgress,
  useReaderPaneProblem,
} from './readerSources'
import {
  BookCover,
  LIBRARY_SORT_LABELS,
  LibrarySearchResults,
  SHELF_ALL,
  SHELF_UNFILED,
  type ReaderShelfFilter,
} from './readerParts'
import './reader.css'

/**
 * The library surface: shelves, collections, search across the local corpus, and what to open.
 *
 * Carved out of `ReaderWorkspace.tsx` alongside the reading pane. The two never shared state —
 * the workspace passes `onOpen` down and the pane hands a source back up — so living in one file
 * bought nothing but the scroll between them.
 */
export function LibraryPane({
  sessionId,
  onOpen,
}: {
  /** The chat the Reader tab belongs to — where a file Reader cannot read is opened instead. */
  sessionId: string
  onOpen: (source: ReaderSource, chapter?: number, highlight?: ReaderTextTarget) => void
}) {
  const [result, setResult] = useState<ReaderLibraryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [contentSearch, setContentSearch] = useState<ReaderLibrarySearchResponse | null>(null)
  const [contentSearchLoading, setContentSearchLoading] = useState(false)
  const [view, setView] = useState<'books' | 'saved'>('books')
  const [sort, setSort] = useState<ReaderLibrarySort>(() => {
    const stored = loadJSON<ReaderLibrarySort>(LIBRARY_SORT_KEY)
    return stored === 'title' || stored === 'progress' || stored === 'format' ? stored : 'recent'
  })
  const [activeCollection, setActiveCollection] = useState<ReaderShelfFilter>(SHELF_ALL)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedBookKeys, setSelectedBookKeys] = useState<Set<string>>(() => new Set())
  const [focusedBookKey, setFocusedBookKey] = useState<string | null>(null)
  const libraryGridRef = useRef<HTMLDivElement>(null)
  const keyboardRoot = useRef<HTMLDivElement>(null)
  const keyboardId = useId()
  const [metadataBook, setMetadataBook] = useState<ReaderBookSummary | null>(null)
  const [collectionBooks, setCollectionBooks] = useState<ReaderBookSummary[] | null>(null)
  const [pendingRemove, setPendingRemove] = useState<ReaderBookSummary[]>([])
  const [removing, setRemoving] = useState(false)
  const saved = useMemo(
    () => (loadJSON<ReaderSavedQuote[]>(QUOTES_KEY) ?? []).map(normalizeReaderSavedQuote),
    [],
  )

  const readRevision = useRef({ value: 0 })
  const refresh = useCallback(async () => {
    const revision = ++readRevision.current.value
    setLoading(true)
    try {
      const next = await readerApi.library()
      if (revision !== readRevision.current.value) return
      setResult(next)
      const available = new Set(next.books.map(readerBookKey))
      setSelectedBookKeys((current) => new Set([...current].filter((key) => available.has(key))))
      setError(null)
    } catch (cause) {
      if (revision !== readRevision.current.value) return
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (revision === readRevision.current.value) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const revision = readRevision.current
    void refresh()
    return () => {
      revision.value++
    }
  }, [refresh])
  const live = useStoreChanges({ plugin: 'reader', sessionId: null }, () => void refresh())
  useVisiblePolling({ enabled: !live, intervalMs: 60_000, onTick: refresh })

  useEffect(() => {
    if (
      activeCollection.kind === 'collection' &&
      !result?.collections.some((collection) => collection.id === activeCollection.id)
    ) {
      setActiveCollection(SHELF_ALL)
    }
  }, [activeCollection, result?.collections])

  useEffect(() => {
    if (view === 'books') return
    setSelectionMode(false)
    setSelectedBookKeys(new Set())
  }, [view])

  useFocusEntry({
    id: `reader-library:${keyboardId}`,
    kind: 'surface',
    active: selectionMode,
    scope: () => keyboardRoot.current,
    onKeyDown: (event) => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      setSelectionMode(false)
      setSelectedBookKeys(new Set())
      return true
    },
  })

  useEffect(() => {
    const value = query.trim()
    if (view !== 'books' || selectionMode || value.length < 2) {
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
    }, 240)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, selectionMode, view])

  // The picker is the reader's only free-form entry point (library rows come from
  // the scanned library, which is already format-filtered). It used to hand ANY
  // pick straight to the reading pane — a picked image opened a reading view that
  // could only fail. Judge the pick here, and when it is not a book let the host
  // open it in whatever viewer owns that type instead of dead-ending in Reader.
  //
  // The viewer opening IS the confirmation, so a handed-off pick posts nothing; only a pick that
  // nothing can open says so. A picker or navigation that throws is reported too, instead of the
  // button silently doing nothing.
  const chooseBook = useCallback(() => {
    runPluginAction(async () => {
      const [path] = await pluginFiles.pickFiles({ extensions: READER_EXTENSIONS })
      if (!path) return
      const reason = readerUnsupportedReason({ path })
      if (!reason) {
        onOpen({ path })
        return
      }
      const name = readerFileName({ path })
      if (
        await pluginNavigation.openBinding(createMessageBindingDraft('file', path, name), sessionId)
      )
        return
      toast.error(`Could not open “${name}”`, { description: reason })
    }, 'Could not open a book')
  }, [onOpen, sessionId])

  const visibleBooks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return sortReaderBooks(
      (result?.books ?? []).filter((book) => {
        const onShelf =
          activeCollection.kind === 'all' ||
          (activeCollection.kind === 'unfiled'
            ? (book.collectionIds?.length ?? 0) === 0
            : book.collectionIds?.includes(activeCollection.id))
        return (
          onShelf &&
          (!needle ||
            `${book.title}\n${book.author ?? ''}\n${book.path}`
              .toLocaleLowerCase()
              .includes(needle))
        )
      }),
      sort,
      storedBookProgress,
    )
  }, [activeCollection, query, result, sort])

  useEffect(() => {
    const keys = new Set(visibleBooks.map(readerBookKey))
    setFocusedBookKey((current) =>
      current && keys.has(current)
        ? current
        : visibleBooks[0]
          ? readerBookKey(visibleBooks[0])
          : null,
    )
  }, [visibleBooks])

  const moveLibraryFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, key: string) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return
    const buttons = Array.from(
      libraryGridRef.current?.querySelectorAll<HTMLButtonElement>('[data-reader-book-key]') ?? [],
    )
    const currentIndex = buttons.findIndex((button) => button.dataset.readerBookKey === key)
    if (currentIndex < 0) return
    let nextIndex = currentIndex
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = buttons.length - 1
    else if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1
    else if (event.key === 'ArrowRight') nextIndex = currentIndex + 1
    else {
      const currentRect = buttons[currentIndex]!.getBoundingClientRect()
      const currentX = currentRect.left + currentRect.width / 2
      const currentY = currentRect.top + currentRect.height / 2
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const candidate = buttons
        .map((button, index) => {
          const rect = button.getBoundingClientRect()
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          return {
            index,
            forward: (y - currentY) * direction > 1,
            distance: Math.abs(y - currentY) * 4 + Math.abs(x - currentX),
          }
        })
        .filter((item) => item.forward)
        .sort((left, right) => left.distance - right.distance)[0]
      if (candidate) nextIndex = candidate.index
    }
    const next = buttons[nextIndex]
    if (!next || nextIndex === currentIndex) return
    event.preventDefault()
    setFocusedBookKey(next.dataset.readerBookKey ?? null)
    next.focus()
  }

  const visibleContentSearch = useMemo(() => {
    if (!contentSearch || activeCollection.kind === 'all') return contentSearch
    return {
      ...contentSearch,
      hits: contentSearch.hits.filter(({ book }) =>
        activeCollection.kind === 'unfiled'
          ? (book.collectionIds?.length ?? 0) === 0
          : book.collectionIds?.includes(activeCollection.id),
      ),
    }
  }, [activeCollection, contentSearch])

  const selectedBooks = useMemo(
    () => (result?.books ?? []).filter((book) => selectedBookKeys.has(readerBookKey(book))),
    [result, selectedBookKeys],
  )

  const activeCollectionLabel =
    activeCollection.kind === 'all'
      ? 'All books'
      : activeCollection.kind === 'unfiled'
        ? 'Unfiled'
        : (result?.collections.find((collection) => collection.id === activeCollection.id)?.name ??
          'All books')

  const visibleSaved = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return saved.filter(
      (item) =>
        !needle ||
        `${item.bookTitle ?? ''}\n${item.chapterTitle}\n${item.quote}`
          .toLocaleLowerCase()
          .includes(needle),
    )
  }, [query, saved])

  const confirmRemove = async () => {
    if (!pendingRemove.length) return
    setRemoving(true)
    try {
      const removed = await readerApi.removeMany(pendingRemove.map(sourceForBook))
      if (removed !== pendingRemove.length) {
        throw new Error(`Reader removed ${removed} of ${pendingRemove.length} selected books`)
      }
      const removedKeys = new Set(pendingRemove.map(readerBookKey))
      setResult((current) =>
        current
          ? {
              ...current,
              books: current.books.filter((book) => !removedKeys.has(readerBookKey(book))),
            }
          : current,
      )
      setSelectedBookKeys((current) => new Set([...current].filter((key) => !removedKeys.has(key))))
      setPendingRemove([])
      if (selectedBookKeys.size === removedKeys.size) setSelectionMode(false)
      setError(null)
    } catch (cause) {
      acknowledgeInline(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRemoving(false)
    }
  }

  const replaceBooks = useCallback((updated: ReaderBookSummary[]) => {
    const byKey = new Map(updated.map((book) => [readerBookKey(book), book]))
    setResult((current) =>
      current
        ? {
            ...current,
            books: current.books.map((book) => byKey.get(readerBookKey(book)) ?? book),
          }
        : current,
    )
  }, [])

  const updateMetadata = async (
    book: ReaderBookSummary,
    patch: Parameters<typeof readerApi.updateMetadata>[1],
  ) => {
    replaceBooks([await readerApi.updateMetadata(sourceForBook(book), patch)])
  }

  const changeCollections = async (
    books: ReaderBookSummary[],
    addIds: string[],
    removeIds: string[],
  ) => {
    if (!books.length) return
    replaceBooks(await readerApi.changeCollections(books.map(sourceForBook), addIds, removeIds))
  }

  const createCollection = async (name: string): Promise<ReaderCollection> => {
    const collection = await readerApi.createCollection(name)
    setResult((current) =>
      current ? { ...current, collections: [...current.collections, collection] } : current,
    )
    return collection
  }

  const renameCollection = async (id: string, name: string) => {
    const collection = await readerApi.renameCollection(id, name)
    setResult((current) =>
      current
        ? {
            ...current,
            collections: current.collections.map((item) =>
              item.id === collection.id ? collection : item,
            ),
          }
        : current,
    )
  }

  const removeCollection = async (id: string) => {
    const removed = await readerApi.removeCollection(id)
    if (!removed) throw new Error('Reader collection was not found')
    setResult((current) =>
      current
        ? {
            books: current.books.map((book) => ({
              ...book,
              collectionIds: (book.collectionIds ?? []).filter((value) => value !== id),
            })),
            collections: current.collections.filter((collection) => collection.id !== id),
          }
        : current,
    )
    if (activeCollection.kind === 'collection' && activeCollection.id === id) {
      setActiveCollection(SHELF_ALL)
    }
  }

  // Owned here, not inside the `error ?` arm: the arm disappears when the library loads, and with
  // it the only thing that could tell the Event Center the failure is over.
  const libraryProblem = useReaderPaneProblem('your library', error, [
    { id: 'retry', label: 'Try again', run: refresh },
  ])

  // `@container`: the library lives in a pane, so its reflow keys on the PANE width. The `sm:`
  // variants below it followed the window instead, and hid the search field and the action
  // labels on a narrow pane only once the whole window was narrow.
  return (
    <div ref={keyboardRoot} className="reader-workspace @container flex h-full min-h-0 flex-col">
      <WorkbenchToolbar aria-label="Reader library controls" as="header">
        <WorkbenchToolbarSection className="min-w-0 flex-1">
          <Library className="size-4 text-text-faint" strokeWidth={1.5} aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">Reader</div>
            <div className="truncate text-2xs text-text-faint">
              {view === 'books' ? 'Library' : 'Annotations'}
            </div>
          </div>
        </WorkbenchToolbarSection>
        <WorkbenchToolbarSection align="end">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={view === 'books' ? 'Search library' : 'Search annotations'}
            aria-label={view === 'books' ? 'Search reader library' : 'Search annotations'}
            size="md"
            className="hidden w-48 @sm:flex"
          />
          {view === 'books' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Sort books" tooltip="Sort books">
                  <ArrowUpDown />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <MenuEntries
                  entries={[
                    { header: 'Sort books' },
                    ...(
                      Object.entries(LIBRARY_SORT_LABELS) as Array<[ReaderLibrarySort, string]>
                    ).map(([value, label]) => ({
                      id: value,
                      label,
                      selected: value === sort,
                      onSelect: () => {
                        setSort(value)
                        saveJSON(LIBRARY_SORT_KEY, value)
                      },
                    })),
                  ]}
                  family="dropdown"
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" onClick={chooseBook}>
            <BookOpen data-icon="inline-start" /> Open book
          </Button>
          <RefreshAction
            size="md"
            tooltip="Refresh library"
            aria-label="Refresh library"
            disabled={loading}
            busy={loading}
            onClick={() => void refresh()}
          />
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      {/* `density="compact"`: this is the SECOND bar of the library's chrome stack. At the
          default density it repeated the identity row's 36px measure, so the two read as one
          doubled band instead of a header and the view/scope row under it. Compact is the
          primitive's "secondary controls" step, and it is the same header-then-compact-row
          junction the API navigator (RestApiSidebar) and the Database explorer already use. */}
      <WorkbenchToolbar aria-label="Library view" density="compact">
        <WorkbenchToolbarSection spacing="compact">
          <Button
            variant={view === 'books' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('books')}
            aria-pressed={view === 'books'}
          >
            <Grid2X2 data-icon="inline-start" /> Books
            <span className="text-text-faint">{result?.books.length ?? 0}</span>
          </Button>
          <Button
            variant={view === 'saved' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('saved')}
            aria-pressed={view === 'saved'}
          >
            <NotebookPen data-icon="inline-start" /> Annotations
            <span className="text-text-faint">{saved.length}</span>
          </Button>
        </WorkbenchToolbarSection>
        {view === 'books' && (
          <WorkbenchToolbarSection align="end" spacing="compact" className="min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={activeCollection.kind === 'all' ? 'ghost' : 'secondary'}
                  size="sm"
                  className="max-w-48"
                  aria-label={`Shelf: ${activeCollectionLabel}`}
                >
                  <Folder data-icon="inline-start" />
                  <span className="truncate">{activeCollectionLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <MenuEntries
                  entries={[
                    { header: 'Collections' },
                    {
                      id: 'all',
                      label: 'All books',
                      selected: activeCollection.kind === 'all',
                      onSelect: () => setActiveCollection(SHELF_ALL),
                    },
                    {
                      id: 'unfiled',
                      label: 'Unfiled',
                      selected: activeCollection.kind === 'unfiled',
                      onSelect: () => setActiveCollection(SHELF_UNFILED),
                    },
                    { separator: true },
                    ...(result?.collections ?? []).map((collection) => ({
                      id: `collection:${collection.id}`,
                      label: collection.name,
                      hint: String(
                        result?.books.filter((book) => book.collectionIds?.includes(collection.id))
                          .length ?? 0,
                      ),
                      selected:
                        activeCollection.kind === 'collection' &&
                        activeCollection.id === collection.id,
                      onSelect: () =>
                        setActiveCollection({ kind: 'collection', id: collection.id }),
                    })),
                    { separator: true },
                    {
                      id: 'manage',
                      label: 'Manage collections…',
                      onSelect: () => setCollectionBooks([]),
                    },
                  ]}
                  family="dropdown"
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant={selectionMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setSelectionMode((current) => !current)
                setSelectedBookKeys(new Set())
              }}
              disabled={(result?.books.length ?? 0) === 0}
              aria-pressed={selectionMode}
            >
              <ListChecks data-icon="inline-start" /> Select
            </Button>
          </WorkbenchToolbarSection>
        )}
      </WorkbenchToolbar>
      <section
        className="min-h-0 flex-1 overflow-auto bg-[var(--reader-paper)] p-5 scrollbar-thin"
        aria-label={view === 'books' ? 'Reader library' : 'Saved annotations'}
      >
        {loading ? (
          <LoadingHint>Loading library…</LoadingHint>
        ) : error ? (
          libraryProblem
        ) : view === 'books' && query.trim().length >= 2 && !selectionMode ? (
          <LibrarySearchResults
            books={visibleBooks}
            content={visibleContentSearch}
            loading={contentSearchLoading}
            onOpen={onOpen}
          />
        ) : view === 'books' ? (
          visibleBooks.length ? (
            <div
              ref={libraryGridRef}
              className="reader-library-grid grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-7"
              role="list"
              aria-label="Book gallery"
            >
              {visibleBooks.map((book) => {
                const source = sourceForBook(book)
                const percent = storedBookProgress(book)
                const key = readerBookKey(book)
                const selected = selectedBookKeys.has(key)
                const toggleSelection = () => {
                  setSelectionMode(true)
                  setSelectedBookKeys((current) => {
                    const next = new Set(current)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
                // One list, two ways in: the cover's hover kebab and a right-click on the card.
                const bookActions: MenuEntry[] = [
                  { id: 'open', label: 'Open', icon: BookOpen, onSelect: () => onOpen(source) },
                  {
                    id: 'details',
                    label: 'Edit details',
                    icon: Pencil,
                    onSelect: () => setMetadataBook(book),
                  },
                  {
                    id: 'collections',
                    label: 'Collections',
                    icon: Folder,
                    onSelect: () => setCollectionBooks([book]),
                  },
                  {
                    id: 'select',
                    label: selected ? 'Deselect' : 'Select',
                    icon: ListChecks,
                    onSelect: toggleSelection,
                  },
                  { separator: true },
                  {
                    id: 'remove',
                    label: 'Remove from library',
                    icon: Trash2,
                    danger: true,
                    onSelect: () => setPendingRemove([book]),
                  },
                ]
                return (
                  <ContextMenu key={key}>
                    <ContextMenuTrigger asChild>
                      <article className="group relative min-w-0" role="listitem">
                        {selectionMode && (
                          <span className="absolute left-2 top-2 z-(--z-controls) flex size-7 items-center justify-center rounded-md bg-popover/95 shadow-(--shadow-raised)">
                            <Checkbox
                              checked={selected}
                              onChange={toggleSelection}
                              aria-label={`${selected ? 'Deselect' : 'Select'} ${book.title}`}
                            />
                          </span>
                        )}
                        <button
                          type="button"
                          draggable={!selectionMode}
                          data-reader-book-key={key}
                          tabIndex={
                            (focusedBookKey ??
                              (visibleBooks[0] ? readerBookKey(visibleBooks[0]) : null)) === key
                              ? 0
                              : -1
                          }
                          aria-pressed={selectionMode ? selected : undefined}
                          className="block w-full text-left outline-none focus-ring"
                          onClick={() => (selectionMode ? toggleSelection() : onOpen(source))}
                          onFocus={() => setFocusedBookKey(key)}
                          onKeyDown={(event) => moveLibraryFocus(event, key)}
                          onDragStart={(event) => {
                            if (selectionMode) {
                              event.preventDefault()
                              return
                            }
                            const binding = resourceMessageBindingDraft(
                              { uri: readerBookUri(source), label: book.title },
                              'drag',
                            )
                            setMessageBindingDrag(event.dataTransfer, binding, {
                              previewLabel: book.title,
                              plainText: binding.target.token,
                            })
                          }}
                        >
                          <span
                            className={`reader-book-cover relative block aspect-[2/3] overflow-hidden rounded-md border bg-card transition-colors group-hover:border-border-strong ${
                              selected
                                ? 'border-foreground/50 ring-2 ring-foreground/25'
                                : 'border-border'
                            }`}
                          >
                            <BookCover book={book} />
                            {percent > 0 && (
                              <span className="absolute inset-x-0 bottom-0 h-1 bg-background/70">
                                <span
                                  className="block h-full bg-[var(--reader-accent)]"
                                  style={{ width: `${percent}%` }}
                                />
                              </span>
                            )}
                          </span>
                          <span className="mt-2 block truncate text-xs font-medium">
                            {book.title}
                          </span>
                          {book.author && (
                            <span className="mt-0.5 block truncate text-2xs text-text-soft">
                              {book.author}
                            </span>
                          )}
                          <span className="mt-0.5 block truncate text-2xs text-text-faint">
                            {book.format.toUpperCase()}
                            {(book.collectionIds?.length ?? 0) > 0
                              ? ` · ${book.collectionIds?.length} ${book.collectionIds?.length === 1 ? 'collection' : 'collections'}`
                              : ''}
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              size="sm"
                              className="absolute right-1 top-1 bg-popover/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                              aria-label={`Book actions for ${book.title}`}
                            >
                              <Ellipsis />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <MenuEntries entries={bookActions} family="dropdown" />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </article>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <MenuEntries entries={bookActions} family="context" />
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          ) : (
            <StateNotice
              icon={BookMarked}
              title={
                query
                  ? 'No matching books'
                  : activeCollection.kind === 'all'
                    ? 'Your library is empty'
                    : `No books in ${activeCollectionLabel}`
              }
              body={
                query
                  ? 'Try a different title or path.'
                  : activeCollection.kind !== 'all'
                    ? 'Use Collections on a book or in selection mode to add it to this shelf.'
                    : 'Open or drop a book. Reader never scans your folders automatically.'
              }
              actions={
                !query && activeCollection.kind === 'all' ? (
                  <Button variant="outline" onClick={chooseBook}>
                    Open book
                  </Button>
                ) : !query ? (
                  <Button variant="outline" onClick={() => setActiveCollection(SHELF_ALL)}>
                    Show all books
                  </Button>
                ) : undefined
              }
            />
          )
        ) : visibleSaved.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
            {visibleSaved.map((item) => {
              const source = sourceFromSaved(item)
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!source}
                  onClick={() =>
                    source && onOpen(source, item.chapter, item.target ?? { quote: item.quote })
                  }
                  className="rounded-lg border border-border bg-card p-4 text-left outline-none transition-colors hover:bg-surface-hover focus-ring disabled:opacity-50"
                >
                  <span className="flex items-start gap-2">
                    <ReaderHighlightSwatch color={item.color ?? 'yellow'} />
                    <span className="line-clamp-4 text-sm/6 text-text-soft">“{item.quote}”</span>
                  </span>
                  {item.note && (
                    <span className="mt-3 line-clamp-3 block border-l border-border pl-3 text-xs/5 text-foreground">
                      {item.note}
                    </span>
                  )}
                  <span className="mt-3 block truncate text-xs font-medium">
                    {item.bookTitle ?? 'Book'}
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-text-faint">
                    {item.chapterTitle}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <StateNotice
            icon={NotebookPen}
            title={query ? 'No matching annotations' : 'Nothing saved yet'}
            body="Select a passage while reading to highlight it or add a note. It will appear here and in the book panel."
          />
        )}
      </section>
      {selectionMode && view === 'books' && (
        <div className="flex min-h-[var(--panel-header-height)] shrink-0 items-center gap-2 border-t border-border-soft bg-background px-3 py-1.5">
          <IconButton
            size="sm"
            onClick={() => {
              setSelectionMode(false)
              setSelectedBookKeys(new Set())
            }}
            aria-label="Exit book selection"
            tooltip="Exit selection"
          >
            <X />
          </IconButton>
          <span className="min-w-0 truncate text-xs font-medium tabular-nums">
            {selectedBooks.length} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const visibleKeys = visibleBooks.map(readerBookKey)
              const allVisibleSelected = visibleKeys.every((key) => selectedBookKeys.has(key))
              setSelectedBookKeys((current) => {
                const next = new Set(current)
                for (const key of visibleKeys) {
                  if (allVisibleSelected) next.delete(key)
                  else next.add(key)
                }
                return next
              })
            }}
            disabled={!visibleBooks.length}
          >
            {visibleBooks.every((book) => selectedBookKeys.has(readerBookKey(book)))
              ? 'Clear shelf'
              : 'Select shelf'}
          </Button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollectionBooks(selectedBooks)}
              disabled={!selectedBooks.length}
            >
              <Folder data-icon="inline-start" />
              <span className="hidden @sm:inline">Collections</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMetadataBook(selectedBooks[0] ?? null)}
              disabled={selectedBooks.length !== 1}
            >
              <Pencil data-icon="inline-start" />
              <span className="hidden @sm:inline">Edit details</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-status-error hover:text-status-error"
              onClick={() => setPendingRemove(selectedBooks)}
              disabled={!selectedBooks.length}
            >
              <Trash2 data-icon="inline-start" />
              <span className="hidden @sm:inline">Remove</span>
            </Button>
          </div>
        </div>
      )}
      <WorkbenchStatusBar aria-label="Reader library status">
        <WorkbenchStatusItem>{result?.books.length ?? 0} books</WorkbenchStatusItem>
        <WorkbenchStatusItem>{result?.collections.length ?? 0} collections</WorkbenchStatusItem>
        <WorkbenchStatusItem>{saved.length} annotations</WorkbenchStatusItem>
      </WorkbenchStatusBar>
      <ConfirmDialog
        open={pendingRemove.length > 0}
        title={
          pendingRemove.length === 1
            ? `Remove “${pendingRemove[0]?.title ?? 'book'}” from Reader?`
            : `Remove ${pendingRemove.length} books from Reader?`
        }
        description="This removes only the Reader library entries. Original files, progress, and annotations stay on your computer."
        confirmLabel={removing ? 'Removing…' : `Remove${pendingRemove.length > 1 ? ' books' : ''}`}
        onConfirm={() => void confirmRemove()}
        onClose={() => !removing && setPendingRemove([])}
      />
      <ReaderMetadataDialog
        book={metadataBook}
        onClose={() => setMetadataBook(null)}
        onSave={async (patch) => {
          if (metadataBook) await updateMetadata(metadataBook, patch)
        }}
      />
      <ReaderCollectionsDialog
        open={collectionBooks !== null}
        books={collectionBooks ?? []}
        collections={result?.collections ?? []}
        libraryBooks={result?.books ?? []}
        onClose={() => setCollectionBooks(null)}
        onApply={(addIds, removeIds) => changeCollections(collectionBooks ?? [], addIds, removeIds)}
        onCreate={createCollection}
        onRename={renameCollection}
        onDelete={removeCollection}
      />
    </div>
  )
}
