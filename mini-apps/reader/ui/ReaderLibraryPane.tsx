import { useCallback, useMemo, useRef, useState } from 'react'
import { BookMarked, NotebookPen } from 'lucide-react'
import { createMessageBindingDraft, runMiniAppAction, toast } from '@localixai/mini-app-sdk/ui'
import { miniAppFiles, miniAppNavigation } from '@localixai/mini-app-sdk/ui/runtime'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'

import type { ReaderBookSummary, ReaderSource } from '../shared/contracts'
import { READER_EXTENSIONS, readerFileName, readerUnsupportedReason } from '../shared/formats'
import {
  normalizeReaderSavedQuote,
  sortReaderBooks,
  type ReaderLibrarySort,
  type ReaderSavedQuote,
  type ReaderTextTarget,
} from './model'
import {
  filterContentSearch,
  filterLibraryBooks,
  filterSavedQuotes,
  readLibrarySort,
  shelfLabel,
} from './libraryPaneModel'
import { ReaderCollectionsDialog, ReaderMetadataDialog } from './ReaderLibraryDialogs'
import { ReaderLibraryGallery } from './ReaderLibraryGallery'
import { ReaderLibrarySavedGrid, ReaderLibrarySelectionBar } from './ReaderLibraryPanels'
import {
  ReaderLibraryHeader,
  ReaderLibraryViewBar,
  type ReaderLibraryView,
} from './ReaderLibraryToolbars'
import { LIBRARY_SORT_KEY, QUOTES_KEY } from './readerStorage'
import { readerBookKey, storedBookProgress, useReaderPaneProblem } from './readerSources'
import { LibrarySearchResults, SHELF_ALL, type ReaderShelfFilter } from './readerParts'
import { useReaderLibrary } from './useReaderLibrary'
import { useReaderLibraryContentSearch } from './useReaderLibraryContentSearch'
import { useReaderLibrarySelection } from './useReaderLibrarySelection'
import './reader.css'

/**
 * The library surface: shelves, collections, search across the local corpus, and what to open.
 *
 * Carved out of `ReaderWorkspace.tsx` alongside the reading pane. The two never shared state —
 * the workspace passes `onOpen` down and the pane hands a source back up — so living in one file
 * bought nothing but the scroll between them. Loading, selection and content search are sibling
 * hooks; the toolbars, gallery and selection bar are sibling components.
 */
export function LibraryPane({
  sessionId,
  onOpen,
}: {
  /** The chat the Reader tab belongs to — where a file Reader cannot read is opened instead. */
  sessionId: string
  onOpen: (source: ReaderSource, chapter?: number, highlight?: ReaderTextTarget) => void
}) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ReaderLibraryView>('books')
  const [sort, setSort] = useState<ReaderLibrarySort>(() =>
    readLibrarySort(loadJSON<ReaderLibrarySort>(LIBRARY_SORT_KEY)),
  )
  const [activeCollection, setActiveCollection] = useState<ReaderShelfFilter>(SHELF_ALL)
  const [requestedBookKey, setFocusedBookKey] = useState<string | null>(null)
  const keyboardRoot = useRef<HTMLDivElement>(null)
  const [metadataBook, setMetadataBook] = useState<ReaderBookSummary | null>(null)
  const [collectionBooks, setCollectionBooks] = useState<ReaderBookSummary[] | null>(null)
  const [pendingRemove, setPendingRemove] = useState<ReaderBookSummary[]>([])
  const [removing, setRemoving] = useState(false)
  const saved = useMemo(
    () => (loadJSON<ReaderSavedQuote[]>(QUOTES_KEY) ?? []).map(normalizeReaderSavedQuote),
    [],
  )

  const selection = useReaderLibrarySelection({ keyboardRoot, view })
  const { selectionMode, selectedBookKeys, setSelectedBookKeys } = selection
  const library = useReaderLibrary({ setSelectedBookKeys })
  const { result, loading, error, refresh } = library

  // A shelf that is gone (the library was re-read without it) goes back to all books, in the
  // render that found it missing.
  if (
    activeCollection.kind === 'collection' &&
    !result?.collections.some((collection) => collection.id === activeCollection.id)
  ) {
    setActiveCollection(SHELF_ALL)
  }

  const { contentSearch, contentSearchLoading } = useReaderLibraryContentSearch({
    query,
    enabled: view === 'books' && !selectionMode,
  })

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
    runMiniAppAction(async () => {
      const [path] = await miniAppFiles.pickFiles({ extensions: READER_EXTENSIONS })
      if (!path) return
      const reason = readerUnsupportedReason({ path })
      if (!reason) {
        onOpen({ path })
        return
      }
      const name = readerFileName({ path })
      if (
        await miniAppNavigation.openBinding(
          createMessageBindingDraft('file', path, name),
          sessionId,
        )
      )
        return
      toast.error(`Could not open “${name}”`, { description: reason })
    }, 'Could not open a book')
  }, [onOpen, sessionId])

  const visibleBooks = useMemo(
    () =>
      sortReaderBooks(
        filterLibraryBooks(result?.books ?? [], activeCollection, query),
        sort,
        storedBookProgress,
      ),
    [activeCollection, query, result, sort],
  )

  // The focused book is the one asked for while it is still shown, else the first one shown.
  const focusedBookKey = useMemo(() => {
    const keys = new Set(visibleBooks.map(readerBookKey))
    if (requestedBookKey && keys.has(requestedBookKey)) return requestedBookKey
    return visibleBooks[0] ? readerBookKey(visibleBooks[0]) : null
  }, [requestedBookKey, visibleBooks])

  const visibleContentSearch = useMemo(
    () => filterContentSearch(contentSearch, activeCollection),
    [activeCollection, contentSearch],
  )

  const selectedBooks = useMemo(
    () => (result?.books ?? []).filter((book) => selectedBookKeys.has(readerBookKey(book))),
    [result, selectedBookKeys],
  )

  const activeCollectionLabel = shelfLabel(activeCollection, result?.collections ?? [])

  const visibleSaved = useMemo(() => filterSavedQuotes(saved, query), [query, saved])

  const confirmRemove = async () => {
    if (!pendingRemove.length) return
    setRemoving(true)
    try {
      const removedKeys = await library.removeBooks(pendingRemove)
      if (!removedKeys) return
      setSelectedBookKeys((current) => new Set([...current].filter((key) => !removedKeys.has(key))))
      setPendingRemove([])
      if (selectedBookKeys.size === removedKeys.size) selection.setSelectionMode(false)
      library.setError(null)
    } finally {
      setRemoving(false)
    }
  }

  const removeCollection = async (id: string) => {
    await library.removeCollection(id)
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
      <ReaderLibraryHeader
        view={view}
        query={query}
        sort={sort}
        loading={loading}
        onQueryChange={setQuery}
        onSortChange={(value) => {
          setSort(value)
          saveJSON(LIBRARY_SORT_KEY, value)
        }}
        onChooseBook={chooseBook}
        onRefresh={() => void refresh()}
      />
      <ReaderLibraryViewBar
        view={view}
        result={result}
        savedCount={saved.length}
        activeCollection={activeCollection}
        activeCollectionLabel={activeCollectionLabel}
        selectionMode={selectionMode}
        onViewChange={setView}
        onCollectionChange={setActiveCollection}
        onManageCollections={() => setCollectionBooks([])}
        onToggleSelectionMode={selection.toggleSelectionMode}
      />
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
            <ReaderLibraryGallery
              books={visibleBooks}
              focusedBookKey={focusedBookKey}
              selectionMode={selectionMode}
              selectedBookKeys={selectedBookKeys}
              onFocusedBookKeyChange={setFocusedBookKey}
              onOpen={onOpen}
              onToggleBook={selection.toggleBook}
              onEditDetails={setMetadataBook}
              onEditCollections={(book) => setCollectionBooks([book])}
              onRemove={(book) => setPendingRemove([book])}
            />
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
                  <Button variant="ghost" onClick={chooseBook}>
                    Open book
                  </Button>
                ) : !query ? (
                  <Button variant="ghost" onClick={() => setActiveCollection(SHELF_ALL)}>
                    Show all books
                  </Button>
                ) : undefined
              }
            />
          )
        ) : visibleSaved.length ? (
          <ReaderLibrarySavedGrid items={visibleSaved} onOpen={onOpen} />
        ) : (
          <StateNotice
            icon={NotebookPen}
            title={query ? 'No matching annotations' : 'Nothing saved yet'}
            body="Select a passage while reading to highlight it or add a note. It will appear here and in the book panel."
          />
        )}
      </section>
      {selectionMode && view === 'books' && (
        <ReaderLibrarySelectionBar
          selectedCount={selectedBooks.length}
          visibleCount={visibleBooks.length}
          shelfFullySelected={visibleBooks.every((book) =>
            selectedBookKeys.has(readerBookKey(book)),
          )}
          onExit={selection.exitSelection}
          onToggleShelf={() => selection.toggleShelf(visibleBooks.map(readerBookKey))}
          onCollections={() => setCollectionBooks(selectedBooks)}
          onEditDetails={() => setMetadataBook(selectedBooks[0] ?? null)}
          onRemove={() => setPendingRemove(selectedBooks)}
        />
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
          if (metadataBook) await library.updateMetadata(metadataBook, patch)
        }}
      />
      <ReaderCollectionsDialog
        open={collectionBooks !== null}
        books={collectionBooks ?? []}
        collections={result?.collections ?? []}
        libraryBooks={result?.books ?? []}
        onClose={() => setCollectionBooks(null)}
        onApply={(addIds, removeIds) =>
          library.changeCollections(collectionBooks ?? [], addIds, removeIds)
        }
        onCreate={library.createCollection}
        onRename={library.renameCollection}
        onDelete={removeCollection}
      />
    </div>
  )
}
