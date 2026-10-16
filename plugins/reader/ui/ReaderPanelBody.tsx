import type { Dispatch, RefObject, SetStateAction } from 'react'
import { EmptyHint } from '@localixai/kit/empty-hint'

import type { ReaderDocument, ReaderSearchMatch, ReaderSource } from '../shared/contracts'
import type { ReaderSavedQuote, ReaderTextTarget } from './model'
import { AnnotationCard } from './readerParts'
import type { ReaderSidePanel } from './readerPaneModel'
import type { useBookmarks, useSavedQuotes } from './readerStorage'
import { ReaderBookmarkList, ReaderTocTree } from './ReaderBookPanelLists'
import { ReaderSearchPanel } from './ReaderSearchPanel'
import { ReaderStatsPanel, type useReaderStatsTracker } from './ReaderStats'

/** The open book the panel lists, and how a list entry moves the reader. */
export interface ReaderPanelBook {
  source: ReaderSource
  document: ReaderDocument
  chapterIndex: number
  pageDocument: boolean
  workspaceRef: RefObject<HTMLDivElement | null>
  setChapterIndex: (chapter: number) => void
  setHighlightTarget: Dispatch<SetStateAction<ReaderTextTarget | null>>
}

/** Which panel entry is current; held by the pane so it survives the panel closing. */
export interface ReaderPanelSelection {
  searchMatchId: string | null
  setSearchMatchId: (id: string | null) => void
  tocFocusIndex: number
  setTocFocusIndex: (index: number) => void
  activeAnnotationId: string | null
  setActiveAnnotationId: (id: string | null) => void
  editingAnnotationId: string | null
  setEditingAnnotationId: (id: string | null) => void
}

export interface ReaderPanelStores {
  savedQuotes: ReturnType<typeof useSavedQuotes>
  bookmarks: ReturnType<typeof useBookmarks>
  stats: ReturnType<typeof useReaderStatsTracker>
  attachAnnotationContext: (item: ReaderSavedQuote) => void
}

/** The body of the book panel: contents, search, annotations, bookmarks or insights. */
export function ReaderPanelBody({
  sidePanel,
  book,
  selection,
  stores,
}: {
  sidePanel: ReaderSidePanel
  book: ReaderPanelBook
  selection: ReaderPanelSelection
  stores: ReaderPanelStores
}) {
  const { setChapterIndex, setHighlightTarget } = book
  const { activeAnnotationId, setActiveAnnotationId } = selection
  const { editingAnnotationId, setEditingAnnotationId } = selection
  const { quotes, update: updateQuote, remove: removeQuote } = stores.savedQuotes
  const { bookmarks, remove: removeBookmark } = stores.bookmarks
  const statsTracker = stores.stats

  const navigateToSearchMatch = (match: ReaderSearchMatch) => {
    selection.setSearchMatchId(match.id)
    setHighlightTarget(null)
    setChapterIndex(match.chapter)
    requestAnimationFrame(() =>
      setHighlightTarget({
        quote: match.match,
        before: match.before,
        after: match.after,
      }),
    )
  }

  return sidePanel === 'search' ? (
    <ReaderSearchPanel
      source={book.source}
      currentChapter={book.chapterIndex}
      activeMatchId={selection.searchMatchId}
      onNavigate={navigateToSearchMatch}
    />
  ) : sidePanel === 'toc' ? (
    <ReaderTocTree
      document={book.document}
      chapterIndex={book.chapterIndex}
      focusIndex={selection.tocFocusIndex}
      pageDocument={book.pageDocument}
      workspaceRef={book.workspaceRef}
      onFocusIndexChange={selection.setTocFocusIndex}
      onSelectChapter={setChapterIndex}
    />
  ) : sidePanel === 'saved' && quotes.length ? (
    quotes.map((item) => (
      <AnnotationCard
        key={item.id}
        item={item}
        active={activeAnnotationId === item.id}
        editing={editingAnnotationId === item.id}
        onNavigate={() => {
          setActiveAnnotationId(item.id)
          selection.setSearchMatchId(null)
          setHighlightTarget(null)
          requestAnimationFrame(() => setHighlightTarget(item.target ?? { quote: item.quote }))
          setChapterIndex(item.chapter)
        }}
        onEdit={(editing) => setEditingAnnotationId(editing ? item.id : null)}
        onChange={(patch) => updateQuote(item.id, patch)}
        onRemove={() => {
          removeQuote(item.id)
          if (activeAnnotationId === item.id) setActiveAnnotationId(null)
          if (editingAnnotationId === item.id) setEditingAnnotationId(null)
        }}
        onAddContext={() => stores.attachAnnotationContext(item)}
      />
    ))
  ) : sidePanel === 'bookmarks' && bookmarks.length ? (
    <ReaderBookmarkList
      bookmarks={bookmarks}
      onSelectChapter={setChapterIndex}
      onRemove={removeBookmark}
    />
  ) : sidePanel === 'insights' ? (
    <ReaderStatsPanel
      result={statsTracker.stats}
      loading={statsTracker.loading}
      error={statsTracker.error}
      onRetry={() => void statsTracker.load()}
    />
  ) : (
    <EmptyHint className="min-h-40 px-3">
      {sidePanel === 'saved'
        ? 'Select text to highlight it or add a note.'
        : 'Nothing saved here yet.'}
    </EmptyHint>
  )
}
