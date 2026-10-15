import { useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { readerChapterUri } from '../shared/resource-uri'
import { useReaderOpenFailure } from './ReaderOpenFailure'
import { readerProgressPercent, type ReaderPreferences, type ReaderTextTarget } from './model'
import { useReaderPageLayout } from './useReaderPageLayout'
import { useReaderTextSelection } from './useReaderTextSelection'
import { useBookmarks, useReaderPreferences, useSavedQuotes } from './readerStorage'
import { useReaderStatsTracker } from './ReaderStats'
import { ReaderPaneToolbar } from './ReaderPaneToolbar'
import { ReaderPaneToolMenus } from './ReaderPaneToolMenus'
import { ReaderBookPanel } from './ReaderBookPanel'
import { ReaderPaneStatusBar } from './ReaderPaneStatusBar'
import { ReaderPanelBody } from './ReaderPanelBody'
import { ReaderReadingSurface } from './ReaderReadingSurface'
import { readerOpenFailureMessage } from './readerPaneModel'
import type { ReaderPaneProps } from './readerPaneProps'
import { useReaderPanelState } from './useReaderPanelState'
import { useReaderDocumentLoading, useReaderDocumentState } from './useReaderDocumentLoading'
import { useReaderAnnotationMarks } from './useReaderAnnotationMarks'
import { useReaderParagraphFocus } from './useReaderParagraphFocus'
import { useReaderMessageContext } from './useReaderMessageContext'
import { useReaderKeyboard } from './useReaderKeyboard'
import { useReaderNarrowPane, useReaderVisiblePassage } from './useReaderVisiblePassage'
import { useReaderPosition } from './useReaderPosition'
import { useReaderMovement } from './useReaderMovement'
import { useReaderAnnotating } from './useReaderAnnotating'
import { useReaderBookIdentity, useReaderBookTitle } from './useReaderBookIdentity'
import './reader.css'

/**
 * The reading surface: one open book, its chapters, selection, annotations and page layout.
 *
 * Each concern lives in a sibling hook — document loading, auto-scroll, speed reading, target
 * reveal, navigation history, notes, article links, annotation marks and actions, paragraph
 * focus, keyboard — the reading position in `useReaderPosition`, and the chrome, panel body and
 * reading surface in sibling components. What stays here is the wiring between them.
 */
export function ReaderPane(props: ReaderPaneProps) {
  const { sessionId, path, mediaId, name, initialChapter, initialHighlight, visible } = props
  const { onBack, onOpenBook, onClosePane, onActivate, onChapterChange, onUnreadable } = props
  const { onParallelRead, publishMessageContext } = props
  const { compact = false, keyboardActive = true, parallelActive = false } = props
  const { source, sourceKey } = useReaderBookIdentity({ path, mediaId, name })
  const documentState = useReaderDocumentState(initialChapter)
  const { document, chapter, chapterIndex, setChapterIndex, loadedChapterIndex } = documentState
  const { loading, error, errorDetail, setError, setErrorDetail, setReloadToken } = documentState
  const bookTitle = useReaderBookTitle({ sourceKey, document, name })
  const { libraryBooks, currentBook, displayBookTitle, displayBookAuthor } = bookTitle
  const [highlightTarget, setHighlightTarget] = useState<ReaderTextTarget | null>(
    initialHighlight ?? null,
  )
  const [preferences, setPreferences] = useReaderPreferences()
  const savedQuotes = useSavedQuotes(sourceKey)
  const { quotes } = savedQuotes
  const bookmarkStore = useBookmarks(sourceKey)
  const { bookmarks, toggle: toggleBookmark } = bookmarkStore
  const articleRef = useRef<HTMLElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const readerSurfaceRef = useRef<HTMLElement>(null)
  const panelToggleRef = useRef<HTMLButtonElement>(null)
  const annotationImportRef = useRef<HTMLInputElement>(null)
  const chapterCount = document?.chapters.length
  const { viewMode } = preferences
  const position = useReaderPosition({ sourceKey, chapterIndex, chapterCount, viewMode })
  const { scrollFraction, pagePosition } = position
  const chapterContentKey = chapter
    ? `${sourceKey}:${chapter.index}:${chapter.kind}:${chapter.content.length}`
    : null
  const textSelection = useReaderTextSelection({
    articleRef,
    scrollRef,
    surfaceRef: readerSurfaceRef,
    contentKey: chapterContentKey,
  })
  const { selection, clearSelection } = textSelection
  const { fontSize, fontFamily, lineHeight, measure, pageMargin, textAlign } = preferences
  const { syncPageTabStops } = useReaderPageLayout({
    articleRef,
    scrollRef,
    contentKey: chapterContentKey,
    layoutKey: [fontSize, fontFamily, lineHeight, measure, pageMargin, textAlign].join(':'),
    viewMode,
    requestedFractionRef: position.modeSwitchFractionRef,
    onPagePositionChange: position.setPagePosition,
  })
  const { visiblePassage, setVisiblePassage } = useReaderVisiblePassage({
    articleRef,
    scrollRef,
    chapter,
    scrollFraction,
    preferences,
  })
  const narrowPane = useReaderNarrowPane(workspaceRef, chapter, document)
  const panel = useReaderPanelState({
    initialChapter,
    chapterIndex,
    collapsed: compact || narrowPane,
  })
  const { sidePanel, setSidePanel, panelOpen, setPanelOpen, openSidePanel } = panel
  const { activeAnnotationId } = panel.selection
  const statsTracker = useReaderStatsTracker({
    source,
    enabled: visible && keyboardActive && Boolean(document && chapter),
    chapter: chapterIndex,
    position: viewMode === 'page' ? pagePosition.current : chapterIndex + 1,
    totalPositions: viewMode === 'page' ? pagePosition.total : (chapterCount ?? 1),
    progress: readerProgressPercent(chapterIndex, chapterCount ?? 1, scrollFraction),
    observe: sidePanel === 'insights' && panelOpen,
  })

  useEffect(() => onChapterChange?.(chapterIndex), [chapterIndex, onChapterChange])

  useReaderDocumentLoading({
    state: documentState,
    source,
    sourceKey,
    initialChapter,
    onUnreadable,
    clearSelection,
    setVisiblePassage,
    position,
    articleRef,
  })
  useReaderAnnotationMarks({ articleRef, chapter, quotes, activeAnnotationId })
  const { syncParagraphFocus, moveParagraphFocus } = useReaderParagraphFocus({
    articleRef,
    scrollRef,
    chapter,
    focusMode: preferences.focusMode,
  })
  const { autoScroll, navigation, speed } = useReaderMovement({
    refs: { scroll: scrollRef, article: articleRef },
    book: documentState,
    position,
    preferences,
    sourceKey,
    active: { visible, keyboardActive },
    highlight: { target: highlightTarget, setTarget: setHighlightTarget },
  })

  const chapterResource = chapter ? readerChapterUri(source, chapter.index) : null
  useReaderMessageContext({
    visible,
    chapter,
    chapterResource,
    document,
    displayBookTitle,
    contextPage: pagePosition.current,
    viewMode,
    publishMessageContext,
    selection,
    visiblePassage,
  })

  useReaderKeyboard({
    workspaceRef,
    panelToggleRef,
    active: visible && keyboardActive,
    speedReadingOpen: speed.speedReadingOpen,
    viewMode,
    autoScrollActive: autoScroll.autoScrollActive,
    panelOpen,
    narrowPane,
    hasSelection: Boolean(selection),
    openSearch: () => openSidePanel('search'),
    startAutoScroll: autoScroll.startAutoScroll,
    stopAutoScroll: autoScroll.stopAutoScroll,
    toggleAutoScrollPause: () => autoScroll.setAutoScrollPaused((value) => !value),
    closePanel: () => setPanelOpen(false),
    clearSelection,
    moveNavigationHistory: navigation.moveNavigationHistory,
    turnReadingPosition: navigation.turnReadingPosition,
  })

  const { annotations, notes, links } = useReaderAnnotating({
    refs: { article: articleRef, importInput: annotationImportRef },
    book: {
      sessionId,
      source,
      sourceKey,
      document,
      chapter,
      loadedChapterIndex,
      displayBookTitle,
      displayBookAuthor,
    },
    textSelection,
    savedQuotes,
    preferences,
    setPreferences,
    annotationState: {
      setActiveId: panel.selection.setActiveAnnotationId,
      setEditingId: panel.selection.setEditingAnnotationId,
    },
    actions: {
      showAnnotations: () => openSidePanel('saved'),
      navigateReader: navigation.navigateReader,
      moveParagraphFocus,
    },
  })
  const { notePopover, closeNotePopover } = notes

  const onScroll = () => {
    if (notePopover) closeNotePopover()
    const scroller = scrollRef.current
    if (scroller) {
      position.recordScroll(scroller)
      syncPageTabStops()
    }
    statsTracker.markActivity()
    syncParagraphFocus()
  }

  const changeViewMode = (next: ReaderPreferences['viewMode']) => {
    if (next === viewMode) return
    position.holdForModeSwitch()
    setPreferences({ ...preferences, viewMode: next })
  }

  // Owned ABOVE the branches, so the row settles when the book finally opens instead of when the
  // branch that drew it stops rendering. `null` while the pane is healthy is what settles it.
  const openFailure = useReaderOpenFailure({
    sessionId,
    source,
    detail: errorDetail,
    message: readerOpenFailureMessage({
      loading,
      error,
      hasDocument: Boolean(document),
      hasChapter: Boolean(chapter),
    }),
    onBack: onBack ?? onClosePane,
    onRetry: () => {
      setError(null)
      setErrorDetail(null)
      setReloadToken((token) => token + 1)
    },
  })

  if (loading && !chapter) return <LoadingHint>Opening reading view…</LoadingHint>
  if (error && !chapter) return openFailure
  // Parsed, but nothing to show. Still an exit-less pane without the report's actions.
  if (!document || !chapter) return openFailure

  const wholeProgress = readerProgressPercent(
    chapterIndex,
    document.chapters.length,
    scrollFraction,
  )
  const isChapterBookmarked = bookmarks.some((item) => item.chapter === chapter.index)
  const fixedPageDocument = document.format === 'cbz'
  const pageDocument = fixedPageDocument || document.format === 'pdf'
  const controlsCompact = compact || narrowPane

  return (
    <div
      ref={workspaceRef}
      className={`reader-workspace relative flex h-full min-h-0 flex-col${compact ? ' reader-pane-compact' : ''}`}
      onPointerDownCapture={() => {
        onActivate?.()
        statsTracker.markActivity()
      }}
      onKeyDownCapture={statsTracker.markActivity}
      onWheelCapture={statsTracker.markActivity}
    >
      <ReaderPaneToolbar
        document={document}
        chapter={chapter}
        chapterIndex={chapterIndex}
        chapterResource={chapterResource}
        displayBookTitle={displayBookTitle}
        libraryBooks={libraryBooks}
        sourceKey={sourceKey}
        panelOpen={panelOpen}
        panelToggleRef={panelToggleRef}
        searchOpen={sidePanel === 'search'}
        chapterBookmarked={isChapterBookmarked}
        onClosePane={onClosePane}
        onTogglePanel={() => setPanelOpen((value) => !value)}
        onBack={onBack}
        onOpenBook={onOpenBook}
        onRefreshLibrary={() => void bookTitle.refreshLibraryBooks()}
        onSelectChapter={setChapterIndex}
        onOpenSearch={() => openSidePanel('search')}
        onToggleBookmark={() =>
          toggleBookmark({
            id: crypto.randomUUID(),
            source,
            path: sourceKey,
            bookTitle: displayBookTitle,
            chapter: chapter.index,
            chapterTitle: chapter.title,
            createdAt: new Date().toISOString(),
          })
        }
      >
        <ReaderPaneToolMenus
          preferences={preferences}
          setPreferences={setPreferences}
          fixedPageDocument={fixedPageDocument}
          autoScroll={autoScroll}
          speed={speed}
          parallel={{ onRead: onParallelRead, active: parallelActive }}
          onViewModeChange={changeViewMode}
        />
      </ReaderPaneToolbar>
      <div className="relative flex min-h-0 flex-1">
        {panelOpen && (
          <ReaderBookPanel
            document={document}
            currentBook={currentBook}
            displayBookTitle={displayBookTitle}
            displayBookAuthor={displayBookAuthor}
            pageDocument={pageDocument}
            sidePanel={sidePanel}
            quoteCount={quotes.length}
            bookmarkCount={bookmarks.length}
            onSidePanelChange={setSidePanel}
            onDismiss={() => setPanelOpen(false)}
            headerActions={
              sidePanel === 'saved' ? (
                <>
                  <input
                    ref={annotationImportRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void annotations.importAnnotations(file)
                    }}
                  />
                  <IconButton
                    size="sm"
                    onClick={() => annotationImportRef.current?.click()}
                    aria-label="Import annotations"
                    tooltip="Import annotations"
                  >
                    <Upload />
                  </IconButton>
                  {quotes.length > 0 && (
                    <IconButton
                      size="sm"
                      onClick={() => void annotations.exportAnnotations()}
                      aria-label="Export annotations"
                      tooltip="Export annotations"
                    >
                      <Download />
                    </IconButton>
                  )}
                </>
              ) : undefined
            }
          >
            <ReaderPanelBody
              sidePanel={sidePanel}
              book={{
                source,
                document,
                chapterIndex,
                pageDocument,
                workspaceRef,
                setChapterIndex,
                setHighlightTarget,
              }}
              selection={panel.selection}
              stores={{
                savedQuotes,
                bookmarks: bookmarkStore,
                stats: statsTracker,
                attachAnnotationContext: annotations.attachAnnotationContext,
              }}
            />
          </ReaderBookPanel>
        )}
        <ReaderReadingSurface
          refs={{ surface: readerSurfaceRef, scroll: scrollRef, article: articleRef }}
          reading={{ sourceKey, displayBookTitle, chapter, preferences, setPreferences }}
          tools={{ position, textSelection, links, notes, speed, annotations }}
          onScroll={onScroll}
        />
      </div>
      <ReaderPaneStatusBar
        document={document}
        chapter={chapter}
        chapterIndex={chapterIndex}
        loadedChapterIndex={loadedChapterIndex}
        pagePosition={pagePosition}
        preferences={preferences}
        wholeProgress={wholeProgress}
        pageDocument={pageDocument}
        fixedPageDocument={fixedPageDocument}
        controlsCompact={controlsCompact}
        navigationTrail={navigation.navigationTrail}
        autoScrollActive={autoScroll.autoScrollActive}
        autoScrollPaused={autoScroll.autoScrollPaused}
        speedReadingOpen={speed.speedReadingOpen}
        onMoveHistory={navigation.moveNavigationHistory}
        onTurn={navigation.turnReadingPosition}
      />
    </div>
  )
}
