import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  ListTree,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Redo2,
  Search,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import {
  acknowledgeInline,
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
  toast,
  type PublishMessageContext,
} from '@localixai/plugin-sdk/ui'
import { setMessageBindingDrag } from '@localixai/plugin-sdk/ui/message-binding-drag'
import {
  pluginClipboard,
  pluginComposer,
  pluginExternal,
  pluginFiles,
} from '@localixai/plugin-sdk/ui/runtime'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

import { IconButton } from '@localixai/kit/icon-button'
import { BreadcrumbSelect } from '@localixai/kit/breadcrumb-select'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

import type {
  ReaderChapter,
  ReaderDocument,
  ReaderSearchMatch,
  ReaderSource,
} from '../shared/contracts'
import { readerUnsupportedReason } from '../shared/formats'
import { readerLinkGesture, readerLinkTarget } from '../shared/link'
import { readerChapterUri } from '../shared/resource-uri'
import { readerApi } from './api'
import { useReaderOpenFailure } from './ReaderOpenFailure'
import { highlightReaderCode } from './code-highlighting'
import {
  emptyReaderNavigationTrail,
  findReaderTextRange,
  moveReaderNavigation,
  parseReaderAnnotationExport,
  readerAutoScrollDistance,
  readerFragmentTarget,
  readerNearestFocusBlock,
  readerNotePreview,
  readerNoteReferenceStrength,
  readerProgressPercent,
  pushReaderNavigation,
  readerSpeedStartIndex,
  readerSpeedTokens,
  readerVisiblePassage,
  sanitizeReaderHtml,
  type ReaderHighlightColor,
  type ReaderNavigationLocation,
  type ReaderPreferences,
  type ReaderProgress,
  type ReaderSavedQuote,
  type ReaderTextTarget,
} from './model'
import {
  readerPageOffsetAtOffset,
  readerPageOffsetAtFraction,
  readerPagePosition,
  readerViewportFraction,
} from './pagination'
import { ReaderSearchPanel } from './ReaderSearchPanel'
import { ReaderNotePopover, type ReaderNotePopoverValue } from './ReaderNotePopover'
import { ReaderReadingToolsMenu } from './ReaderReadingToolsMenu'
import { ReaderSelectionToolbar } from './ReaderSelectionToolbar'
import { useReaderPageLayout } from './useReaderPageLayout'
import { useReaderLibraryBooks } from './useReaderLibraryBooks'
import { useReaderTextSelection } from './useReaderTextSelection'
import {
  progressKey,
  readingMinutes,
  useBookmarks,
  useReaderPreferences,
  useSavedQuotes,
} from './readerStorage'
import { ReaderStatsPanel, useReaderStatsTracker } from './ReaderStats'
import {
  readerFailureDetail,
  readerMotionSafeScrollBehavior,
  sourceForBook,
  sourceStorageKey,
} from './readerSources'
import { AnnotationCard, BookCover, ChapterContent } from './readerParts'
import { ReaderAppearanceMenu } from './ReaderAppearanceMenu'
import './reader.css'

/**
 * The reading surface: one open book, its chapters, selection, annotations and page layout.
 *
 * Carved out of `ReaderWorkspace.tsx`, which was 4,386 lines — by a wide margin the largest file
 * in the repository, and three unrelated screens deep. This is the biggest of the three, and it
 * takes plain props, so that split was a move rather than a redesign.
 *
 * WHY IT IS STILL LARGE, measured rather than assumed. Two seams were looked for and neither is
 * here. By STATE: speed reading looks separable until `stopSpeedReading`, which converts a token
 * index into a scroll fraction, writes the stored reading position, and re-seats the scroller
 * differently per view mode — so "speed reading" is really a fourth way of expressing one reading
 * POSITION that scroll, pagination and progress also express. By RENDER: the toolbar reads 25
 * identifiers from component scope, the body 57. A component whose props list is 57 lines long is
 * not clearer than the code it replaced.
 *
 * What would actually shrink this is giving reading position a single owner — one hook that holds
 * the position and knows how to express it as a scroll offset, a page, a fraction, or a token
 * index — after which the modes become thin. That is a redesign of the thing this file is about,
 * with no test covering position restore today. Worth doing; not worth doing carelessly.
 */
export function ReaderPane({
  sessionId,
  path,
  mediaId,
  name,
  initialChapter,
  initialHighlight,
  visible,
  onBack,
  onOpenBook,
  compact = false,
  keyboardActive = true,
  parallelActive = false,
  onParallelRead,
  onClosePane,
  onActivate,
  onChapterChange,
  onUnreadable,
  publishMessageContext,
}: {
  sessionId: string
  path?: string
  mediaId?: string
  name?: string
  initialChapter?: number
  initialHighlight?: ReaderTextTarget
  visible: boolean
  onBack?: () => void
  onOpenBook: (source: ReaderSource) => void
  compact?: boolean
  keyboardActive?: boolean
  parallelActive?: boolean
  onParallelRead?: () => void
  onClosePane?: () => void
  onActivate?: () => void
  onChapterChange?: (chapter: number) => void
  /** The source turned out to be unreadable — the owner drops it so a reopened
   *  Reader lands on the library instead of restoring the failure. */
  onUnreadable?: (source: ReaderSource) => void
  publishMessageContext?: PublishMessageContext
}) {
  const source = useMemo<ReaderSource>(
    () => (path ? { path } : { mediaId: mediaId!, ...(name ? { name } : {}) }),
    [mediaId, name, path],
  )
  const sourceKey = path ?? `media:${mediaId}`
  const [document, setDocument] = useState<ReaderDocument | null>(null)
  const { books: libraryBooks, refresh: refreshLibraryBooks } = useReaderLibraryBooks(
    document ? sourceKey : null,
  )
  const currentBook = useMemo(
    () => libraryBooks.find((book) => sourceStorageKey(sourceForBook(book)) === sourceKey),
    [libraryBooks, sourceKey],
  )
  const displayBookTitle = currentBook?.title ?? document?.title ?? name ?? 'Book'
  const displayBookAuthor = currentBook?.author ?? document?.author
  const [chapter, setChapter] = useState<ReaderChapter | null>(null)
  const [chapterIndex, setChapterIndex] = useState(initialChapter ?? 0)
  const [loadedChapterIndex, setLoadedChapterIndex] = useState(initialChapter ?? 0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** What the parser itself said, when it was not us. Event Center only, never on the pane. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  /** Bumped by "Try again" — a transient failure (a file still being written, a
   *  backend hiccup) must be recoverable without closing the tab. */
  const [reloadToken, setReloadToken] = useState(0)
  const [highlightTarget, setHighlightTarget] = useState<ReaderTextTarget | null>(
    initialHighlight ?? null,
  )
  const [activeSearchMatch, setActiveSearchMatch] = useState<string | null>(null)
  const [pendingFragment, setPendingFragment] = useState<{
    chapter: number
    fragment: string
  } | null>(null)
  const [navigationTrail, setNavigationTrail] = useState(emptyReaderNavigationTrail)
  const [notePopover, setNotePopover] = useState<ReaderNotePopoverValue | null>(null)
  const [scrollFraction, setScrollFraction] = useState(0)
  const [pagePosition, setPagePosition] = useState({ current: 1, total: 1 })
  const [visiblePassage, setVisiblePassage] = useState('')
  const [sidePanel, setSidePanel] = useState<'toc' | 'search' | 'saved' | 'bookmarks' | 'insights'>(
    'toc',
  )
  const [panelOpen, setPanelOpen] = useState(true)
  const [tocFocusIndex, setTocFocusIndex] = useState(initialChapter ?? 0)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [preferences, setPreferences] = useReaderPreferences()
  const [autoScrollActive, setAutoScrollActive] = useState(false)
  const [autoScrollPaused, setAutoScrollPaused] = useState(false)
  const [speedReadingOpen, setSpeedReadingOpen] = useState(false)
  const [speedReadingPlaying, setSpeedReadingPlaying] = useState(false)
  const [speedTokenIndex, setSpeedTokenIndex] = useState(0)
  const {
    quotes,
    save: saveQuote,
    update: updateQuote,
    remove: removeQuote,
    importMany: importQuotes,
  } = useSavedQuotes(sourceKey)
  const { bookmarks, toggle: toggleBookmark, remove: removeBookmark } = useBookmarks(sourceKey)
  const articleRef = useRef<HTMLElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const readerSurfaceRef = useRef<HTMLElement>(null)
  const highlightCleanupRef = useRef<(() => void) | null>(null)
  const annotationCleanupRef = useRef<(() => void) | null>(null)
  const revealFocusCleanupRef = useRef<(() => void) | null>(null)
  const modeSwitchFractionRef = useRef<number | null>(null)
  const pendingChapterFractionRef = useRef<number | null>(null)
  const exactNavigationRef = useRef<{
    chapter: number
    fragment: string
  } | null>(null)
  const visiblePassageFrameRef = useRef(0)
  const autoScrollFrameRef = useRef(0)
  const autoScrollRemainderRef = useRef(0)
  const autoScrollStallRef = useRef<number | null>(null)
  const paragraphFocusFrameRef = useRef(0)
  const paragraphFocusBlocksRef = useRef<HTMLElement[]>([])
  const speedReadingTriggerRef = useRef<HTMLButtonElement>(null)
  const panelToggleRef = useRef<HTMLButtonElement>(null)
  const annotationImportRef = useRef<HTMLInputElement>(null)
  const noteRequestRef = useRef(0)
  const [narrowPane, setNarrowPane] = useState(false)
  const chapterContentKey = chapter
    ? `${sourceKey}:${chapter.index}:${chapter.kind}:${chapter.content.length}`
    : null
  const {
    selection,
    selectionTarget,
    selectionToolbarRef,
    selectionToolbarStyle,
    selectionToolbarPlacement,
    selectionToolbarVisible,
    clearSelection,
    onSelectionPointerDown,
    onSelectionPointerUp,
    onSelectionPointerCancel,
    onSelectionKeyUp,
  } = useReaderTextSelection({
    articleRef,
    scrollRef,
    surfaceRef: readerSurfaceRef,
    contentKey: chapterContentKey,
  })
  const { syncPageTabStops } = useReaderPageLayout({
    articleRef,
    scrollRef,
    contentKey: chapterContentKey,
    layoutKey: [
      preferences.fontSize,
      preferences.fontFamily,
      preferences.lineHeight,
      preferences.measure,
      preferences.pageMargin,
      preferences.textAlign,
    ].join(':'),
    viewMode: preferences.viewMode,
    requestedFractionRef: modeSwitchFractionRef,
    onPagePositionChange: setPagePosition,
  })
  const trackedProgress = readerProgressPercent(
    chapterIndex,
    document?.chapters.length ?? 1,
    scrollFraction,
  )
  const speedTokens = useMemo(() => readerSpeedTokens(chapter?.text ?? ''), [chapter?.text])
  const statsTracker = useReaderStatsTracker({
    source,
    enabled: visible && keyboardActive && Boolean(document && chapter),
    chapter: chapterIndex,
    position: preferences.viewMode === 'page' ? pagePosition.current : chapterIndex + 1,
    totalPositions:
      preferences.viewMode === 'page' ? pagePosition.total : (document?.chapters.length ?? 1),
    progress: trackedProgress,
    observe: sidePanel === 'insights' && panelOpen,
  })

  useEffect(() => {
    const root = workspaceRef.current
    if (!root) return
    const sync = () => setNarrowPane(root.clientWidth <= 704)
    const observer = new ResizeObserver(sync)
    observer.observe(root)
    sync()
    return () => observer.disconnect()
  }, [chapter, document])

  useEffect(() => {
    if (compact || narrowPane) setPanelOpen(false)
  }, [compact, narrowPane])

  useEffect(() => onChapterChange?.(chapterIndex), [chapterIndex, onChapterChange])

  useEffect(() => setTocFocusIndex(chapterIndex), [chapterIndex])

  const stopAutoScroll = useCallback(() => {
    cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollRemainderRef.current = 0
    autoScrollStallRef.current = null
    setAutoScrollActive(false)
    setAutoScrollPaused(false)
  }, [])

  useEffect(() => {
    if (preferences.viewMode !== 'scroll' || !visible) stopAutoScroll()
  }, [preferences.viewMode, stopAutoScroll, visible])

  useEffect(() => {
    if (
      !autoScrollActive ||
      autoScrollPaused ||
      preferences.viewMode !== 'scroll' ||
      !visible ||
      !keyboardActive ||
      !chapter ||
      !document
    ) {
      cancelAnimationFrame(autoScrollFrameRef.current)
      return
    }
    let lastFrame = performance.now()
    const tick = (now: number) => {
      const scroller = scrollRef.current
      if (!scroller || globalThis.document.visibilityState === 'hidden') {
        lastFrame = now
        autoScrollFrameRef.current = requestAnimationFrame(tick)
        return
      }
      const elapsed = now - lastFrame
      lastFrame = now
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const before = scroller.scrollTop
      const distance =
        autoScrollRemainderRef.current +
        readerAutoScrollDistance(preferences.autoScrollSpeed, elapsed)
      const pixels = Math.floor(distance)
      autoScrollRemainderRef.current = distance - pixels
      if (pixels <= 0) {
        autoScrollFrameRef.current = requestAnimationFrame(tick)
        return
      }
      scroller.scrollTop = Math.min(maximum, before + pixels)
      if (scroller.scrollTop > before) {
        autoScrollStallRef.current = null
      } else if (autoScrollStallRef.current === null) {
        autoScrollStallRef.current = now
      } else if (now - autoScrollStallRef.current >= 800) {
        autoScrollStallRef.current = null
        autoScrollRemainderRef.current = 0
        if (chapterIndex < document.chapters.length - 1) {
          pendingChapterFractionRef.current = 0
          setChapterIndex((value) => value + 1)
        } else {
          // Scrolling stops on the last page; that is the whole message, not an Event Center row.
          stopAutoScroll()
        }
        return
      }
      autoScrollFrameRef.current = requestAnimationFrame(tick)
    }
    autoScrollFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(autoScrollFrameRef.current)
  }, [
    autoScrollActive,
    autoScrollPaused,
    chapter,
    chapterIndex,
    document,
    keyboardActive,
    preferences.autoScrollSpeed,
    preferences.viewMode,
    stopAutoScroll,
    visible,
  ])

  useEffect(() => {
    let cancelled = false
    // Judge the source before spending a round-trip on it: an image or any other
    // non-reading format is refused here, with the same wording the backend uses.
    const unsupported = readerUnsupportedReason(source)
    if (unsupported) {
      setDocument(null)
      setChapter(null)
      setError(unsupported)
      setLoading(false)
      onUnreadable?.(source)
      return
    }
    setLoading(true)
    void readerApi
      .document(source)
      .then(({ document: next }) => {
        if (cancelled) return
        setDocument(next)
        const stored = loadJSON<ReaderProgress>(progressKey(sourceKey))
        setChapterIndex(
          Math.min(next.chapters.length - 1, Math.max(0, initialChapter ?? stored?.chapter ?? 0)),
        )
        setError(null)
        setErrorDetail(null)
      })
      .catch((cause) => {
        if (cancelled) return
        acknowledgeInline(cause)
        setError(cause instanceof Error ? cause.message : 'This file could not be opened.')
        setErrorDetail(readerFailureDetail(cause))
        onUnreadable?.(source)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [initialChapter, onUnreadable, reloadToken, source, sourceKey])

  useEffect(() => {
    if (!document) return
    let cancelled = false
    setLoading(true)
    clearSelection()
    setVisiblePassage('')
    setScrollFraction(0)
    void readerApi
      .chapter(source, chapterIndex)
      .then(({ chapter: next }) => {
        if (cancelled) return
        setLoadedChapterIndex(chapterIndex)
        setChapter(next)
        setError(null)
        setErrorDetail(null)
        const stored = loadJSON<ReaderProgress>(progressKey(sourceKey))
        const edgeFraction = pendingChapterFractionRef.current
        pendingChapterFractionRef.current = null
        const fraction = edgeFraction ?? (stored?.chapter === chapterIndex ? stored.fraction : 0)
        modeSwitchFractionRef.current = fraction
        setScrollFraction(fraction)
      })
      .catch((cause) => {
        if (cancelled) return
        acknowledgeInline(cause)
        setError(cause instanceof Error ? cause.message : 'This chapter could not be opened.')
        setErrorDetail(readerFailureDetail(cause))
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [chapterIndex, clearSelection, document, source, sourceKey])

  useEffect(() => {
    if (chapter?.kind !== 'html' || !articleRef.current) return
    const frame = requestAnimationFrame(() => {
      if (articleRef.current) highlightReaderCode(articleRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [chapter])

  useEffect(() => {
    annotationCleanupRef.current?.()
    annotationCleanupRef.current = null
    if (!chapter || !articleRef.current) return
    const chapterAnnotations = quotes.filter((item) => item.chapter === chapter.index)
    if (!chapterAnnotations.length) return
    const frame = requestAnimationFrame(() => {
      const root = articleRef.current
      if (!root) return
      const marks: HTMLElement[] = []
      for (const annotation of chapterAnnotations.toReversed()) {
        const found = findReaderTextRange(root, annotation.target ?? { quote: annotation.quote })
        if (!found) continue
        let interactiveSegment = true
        for (const segment of found.segments) {
          if (!segment.node.isConnected) continue
          const range = globalThis.document.createRange()
          range.setStart(segment.node, segment.start)
          range.setEnd(segment.node, segment.end)
          const mark = globalThis.document.createElement('mark')
          mark.className = 'reader-annotation'
          mark.dataset.readerAnnotationId = annotation.id
          mark.dataset.color = annotation.color ?? 'yellow'
          if (annotation.id === activeAnnotationId) mark.dataset.active = 'true'
          if (annotation.note) mark.title = annotation.note
          if (interactiveSegment) {
            mark.tabIndex = 0
            mark.setAttribute('role', 'button')
            mark.setAttribute(
              'aria-label',
              annotation.note
                ? `Highlighted passage. Note: ${annotation.note}`
                : `Highlighted passage: ${annotation.quote.slice(0, 160)}`,
            )
            interactiveSegment = false
          }
          range.surroundContents(mark)
          marks.push(mark)
        }
      }
      annotationCleanupRef.current = () => {
        for (const mark of marks.toReversed()) {
          const parent = mark.parentNode
          if (!parent) continue
          mark.replaceWith(...mark.childNodes)
          parent.normalize()
        }
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      annotationCleanupRef.current?.()
      annotationCleanupRef.current = null
    }
  }, [activeAnnotationId, chapter, quotes])

  const activateParagraphFocus = useCallback((block: HTMLElement | null, moveFocus = false) => {
    if (!block) return
    for (const candidate of paragraphFocusBlocksRef.current) {
      const active = candidate === block
      candidate.tabIndex = active ? 0 : -1
      if (active) {
        candidate.dataset.readerFocusActive = 'true'
      } else {
        delete candidate.dataset.readerFocusActive
      }
    }
    if (!moveFocus) return
    block.focus({ preventScroll: true })
    block.scrollIntoView({
      block: 'center',
      behavior: readerMotionSafeScrollBehavior('smooth'),
    })
  }, [])

  const syncParagraphFocus = useCallback(() => {
    if (preferences.focusMode !== 'paragraph') return
    cancelAnimationFrame(paragraphFocusFrameRef.current)
    paragraphFocusFrameRef.current = requestAnimationFrame(() => {
      const blocks = paragraphFocusBlocksRef.current
      const scroller = scrollRef.current
      if (!blocks.length || !scroller) return
      const focused = globalThis.document.activeElement?.closest<HTMLElement>(
        '[data-reader-focus-target="true"]',
      )
      if (focused && articleRef.current?.contains(focused)) return
      const viewport = scroller.getBoundingClientRect()
      const index = readerNearestFocusBlock(
        blocks.map((block) => block.getBoundingClientRect()),
        viewport.top,
        viewport.bottom,
      )
      activateParagraphFocus(blocks[index] ?? null)
    })
  }, [activateParagraphFocus, preferences.focusMode])

  useEffect(() => {
    const article = articleRef.current
    if (!article || preferences.focusMode !== 'paragraph') return
    const selector = 'h1,h2,h3,h4,p,li,blockquote,pre,figcaption,td,th'
    const candidates = Array.from(article.querySelectorAll<HTMLElement>(selector))
    const blocks = candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
    )
    paragraphFocusBlocksRef.current = blocks
    for (const block of blocks) {
      block.tabIndex = -1
      block.dataset.readerFocusTarget = 'true'
    }
    syncParagraphFocus()
    const listeners = blocks.map((block) => {
      const activate = () => activateParagraphFocus(block)
      block.addEventListener('focus', activate)
      block.addEventListener('click', activate)
      return { block, activate }
    })
    return () => {
      cancelAnimationFrame(paragraphFocusFrameRef.current)
      paragraphFocusBlocksRef.current = []
      for (const { block, activate } of listeners) {
        block.removeEventListener('focus', activate)
        block.removeEventListener('click', activate)
        if (block.dataset.readerFocusTarget !== 'true') continue
        block.removeAttribute('tabindex')
        delete block.dataset.readerFocusTarget
        delete block.dataset.readerFocusActive
      }
    }
  }, [activateParagraphFocus, chapter, preferences.focusMode, syncParagraphFocus])

  const revealReaderTarget = useCallback(
    (target: HTMLElement, block: ScrollLogicalPosition = 'center') => {
      revealFocusCleanupRef.current?.()
      const root = articleRef.current
      const origin = globalThis.document.activeElement
      const targetId = target.id
      const targetPath: number[] = []
      let pathNode: HTMLElement | null = target
      while (root && pathNode && pathNode !== root) {
        const parent: HTMLElement | null = pathNode.parentElement
        if (!parent) break
        targetPath.unshift(Array.from(parent.children).indexOf(pathNode))
        pathNode = parent
      }
      const resolveTarget = () => {
        if (target.isConnected && articleRef.current?.contains(target)) return target
        if (targetId) {
          const byId = Array.from(
            articleRef.current?.querySelectorAll<HTMLElement>('[id]') ?? [],
          ).find((element) => element.id === targetId)
          if (byId) return byId
        }
        let current: HTMLElement | null = articleRef.current
        for (const index of targetPath) {
          current = (current?.children.item(index) as HTMLElement | null) ?? null
          if (!current) break
        }
        return current
      }
      const scroller = scrollRef.current
      let settled = false
      let settleTimer = 0
      let maximumTimer = 0
      const observer = new ResizeObserver(() => scheduleFocus())
      const release = () => {
        window.clearTimeout(settleTimer)
        window.clearTimeout(maximumTimer)
        observer.disconnect()
        scroller?.removeEventListener('scroll', scheduleFocus)
        if (revealFocusCleanupRef.current === cancel) revealFocusCleanupRef.current = null
      }
      const focusCurrent = () => {
        const current = resolveTarget()
        if (!current) return false
        const active = globalThis.document.activeElement
        if (
          active &&
          active !== globalThis.document.body &&
          active !== origin &&
          active !== current &&
          !current.contains(active)
        ) {
          cancel()
          return false
        }
        const alreadyFocusable = current.matches('a[href],button,input,textarea,select,[tabindex]')
        if (!alreadyFocusable) current.tabIndex = -1
        current.focus({ preventScroll: true })
        current.classList.add('lx-target-reveal')
        window.setTimeout(() => current.classList.remove('lx-target-reveal'), 2_000)
        if (!alreadyFocusable) {
          current.addEventListener('blur', () => current.removeAttribute('tabindex'), {
            once: true,
          })
        }
        return true
      }
      const finish = () => {
        if (settled) return
        settled = true
        release()
        focusCurrent()
      }
      function scheduleFocus() {
        if (settled) return
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(finish, 120)
      }
      const cancel = () => {
        settled = true
        release()
      }
      revealFocusCleanupRef.current = cancel
      if (scroller) {
        scroller.addEventListener('scroll', scheduleFocus, { passive: true })
        observer.observe(scroller)
      }
      if (root) observer.observe(root)
      target.scrollIntoView({
        behavior: 'auto',
        block,
      })
      if (scroller && preferences.viewMode === 'page') {
        scroller.scrollLeft = readerPageOffsetAtOffset(
          scroller.scrollLeft,
          scroller.scrollWidth,
          scroller.clientWidth,
        )
      }
      scheduleFocus()
      maximumTimer = window.setTimeout(focusCurrent, 1_200)
    },
    [preferences.viewMode],
  )

  useEffect(() => () => revealFocusCleanupRef.current?.(), [])

  useEffect(() => {
    highlightCleanupRef.current?.()
    highlightCleanupRef.current = null
    if (!chapter || !highlightTarget || !articleRef.current) return
    const frame = requestAnimationFrame(() => {
      const found = articleRef.current
        ? findReaderTextRange(articleRef.current, highlightTarget)
        : null
      if (!found) return
      const marks: HTMLElement[] = []
      for (const segment of found.segments) {
        if (!segment.node.isConnected) continue
        const range = globalThis.document.createRange()
        range.setStart(segment.node, segment.start)
        range.setEnd(segment.node, segment.end)
        const mark = globalThis.document.createElement('mark')
        mark.className = 'reader-saved-target lx-search-mark'
        range.surroundContents(mark)
        marks.push(mark)
      }
      revealReaderTarget(found.block)
      found.block.classList.add('lx-target-reveal')
      const unwrap = () => {
        for (const mark of marks) {
          const parent = mark.parentNode
          if (!parent) continue
          mark.replaceWith(...mark.childNodes)
          parent.normalize()
        }
      }
      const timer = window.setTimeout(() => {
        unwrap()
        found.block.classList.remove('lx-target-reveal')
      }, 4_000)
      highlightCleanupRef.current = () => {
        window.clearTimeout(timer)
        unwrap()
        found.block.classList.remove('lx-target-reveal')
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      highlightCleanupRef.current?.()
      highlightCleanupRef.current = null
    }
  }, [chapter, highlightTarget, revealReaderTarget])

  useEffect(() => {
    if (!chapter || pendingFragment === null) return
    if (loadedChapterIndex !== pendingFragment.chapter) return
    let timer = 0
    const frame = requestAnimationFrame(() => {
      const root = articleRef.current
      const target = pendingFragment.fragment
        ? root
          ? readerFragmentTarget(root, pendingFragment.fragment)
          : null
        : root
      if (target) {
        if (pendingFragment.fragment) {
          exactNavigationRef.current = {
            chapter: pendingFragment.chapter,
            fragment: pendingFragment.fragment,
          }
        }
        revealReaderTarget(target, 'start')
        target.classList.add('lx-target-reveal')
        timer = window.setTimeout(() => target.classList.remove('lx-target-reveal'), 2_000)
      }
      setPendingFragment(null)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [chapter, loadedChapterIndex, pendingFragment, revealReaderTarget])

  const chapterResource = chapter ? readerChapterUri(source, chapter.index) : null
  const contextPage = pagePosition.current

  useEffect(() => {
    if (!visible || !chapter || !chapterResource || !publishMessageContext || !document) return
    const bindings = [
      resourceMessageBindingDraft({
        uri: chapterResource,
        label: `${displayBookTitle} · ${chapter.title}`,
      }),
      ...(visiblePassage
        ? [
            snippetMessageBindingDraft({
              label:
                preferences.viewMode === 'page'
                  ? `Visible page ${contextPage} · ${chapter.title}`
                  : `Visible passage · ${chapter.title}`,
              content: visiblePassage,
              language: 'text',
            }),
          ]
        : []),
      ...(selection
        ? [
            snippetMessageBindingDraft({
              label: `Selected passage · ${chapter.title}`,
              content: selection,
              language: 'text',
            }),
          ]
        : []),
    ]
    publishMessageContext({ strategy: 'replace', bindings })
    return () => publishMessageContext(null)
  }, [
    chapter,
    chapterResource,
    document,
    displayBookTitle,
    contextPage,
    preferences.viewMode,
    publishMessageContext,
    selection,
    visible,
    visiblePassage,
  ])

  const turnReadingPosition = useCallback(
    (direction: -1 | 1) => {
      exactNavigationRef.current = null
      const scroller = scrollRef.current
      if (preferences.viewMode === 'page' && scroller) {
        const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
        const page = readerPagePosition(
          scroller.scrollLeft,
          scroller.scrollWidth,
          scroller.clientWidth,
        ).current
        const currentOffset = Math.min(maximum, (page - 1) * scroller.clientWidth)
        const atStart = page <= 1
        const atEnd = currentOffset >= maximum - 2
        if (direction < 0 && !atStart) {
          scroller.scrollTo({
            left: Math.max(0, currentOffset - scroller.clientWidth),
            behavior: readerMotionSafeScrollBehavior('smooth'),
          })
          return
        }
        if (direction > 0 && !atEnd) {
          scroller.scrollTo({
            left: Math.min(maximum, currentOffset + scroller.clientWidth),
            behavior: readerMotionSafeScrollBehavior('smooth'),
          })
          return
        }
      }
      const canChangeChapter =
        (direction < 0 && chapterIndex > 0) ||
        (direction > 0 && Boolean(document) && chapterIndex < (document?.chapters.length ?? 0) - 1)
      if (preferences.viewMode === 'page' && canChangeChapter) {
        pendingChapterFractionRef.current = direction < 0 ? 1 : 0
      }
      if (direction < 0 && chapterIndex > 0) setChapterIndex((value) => value - 1)
      if (direction > 0 && document && chapterIndex < document.chapters.length - 1) {
        setChapterIndex((value) => value + 1)
      }
    },
    [chapterIndex, document, preferences.viewMode],
  )

  const currentReaderLocation = useCallback((): ReaderNavigationLocation => {
    const scroller = scrollRef.current
    if (!scroller) return { chapter: loadedChapterIndex, fraction: scrollFraction }
    const paginated = preferences.viewMode === 'page'
    const offset = paginated ? scroller.scrollLeft : scroller.scrollTop
    const extent = paginated ? scroller.scrollWidth : scroller.scrollHeight
    const viewport = paginated ? scroller.clientWidth : scroller.clientHeight
    const exact = exactNavigationRef.current
    return {
      chapter: loadedChapterIndex,
      fraction: readerViewportFraction(offset, extent, viewport),
      ...(exact?.chapter === loadedChapterIndex ? { fragment: exact.fragment } : {}),
    }
  }, [loadedChapterIndex, preferences.viewMode, scrollFraction])

  const applyReaderNavigation = useCallback(
    (location: ReaderNavigationLocation) => {
      const chapterTarget = Math.max(
        0,
        Math.min((document?.chapters.length ?? 1) - 1, Math.floor(location.chapter)),
      )
      const fraction = Math.max(0, Math.min(1, location.fraction))
      setHighlightTarget(null)
      if (chapterTarget === loadedChapterIndex) {
        setPendingFragment(null)
        if (location.fragment && articleRef.current) {
          exactNavigationRef.current = {
            chapter: chapterTarget,
            fragment: location.fragment,
          }
          const destination = readerFragmentTarget(articleRef.current, location.fragment)
          if (destination) revealReaderTarget(destination, 'start')
          return
        }
        exactNavigationRef.current = null
        const scroller = scrollRef.current
        if (!scroller) return
        if (preferences.viewMode === 'page') {
          scroller.scrollLeft = readerPageOffsetAtFraction(
            fraction,
            scroller.scrollWidth,
            scroller.clientWidth,
          )
        } else {
          scroller.scrollTop = fraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        }
        return
      }
      exactNavigationRef.current = location.fragment
        ? { chapter: chapterTarget, fragment: location.fragment }
        : null
      pendingChapterFractionRef.current = location.fragment ? 0 : fraction
      setPendingFragment(
        location.fragment ? { chapter: chapterTarget, fragment: location.fragment } : null,
      )
      setChapterIndex(chapterTarget)
    },
    [document?.chapters.length, loadedChapterIndex, preferences.viewMode, revealReaderTarget],
  )

  const navigateReader = useCallback(
    (location: ReaderNavigationLocation) => {
      const origin = currentReaderLocation()
      setNavigationTrail((trail) => pushReaderNavigation(trail, origin, location))
      applyReaderNavigation(location)
    },
    [applyReaderNavigation, currentReaderLocation],
  )

  const moveNavigationHistory = useCallback(
    (direction: 'back' | 'forward') => {
      const moved = moveReaderNavigation(navigationTrail, currentReaderLocation(), direction)
      if (!moved.location) return
      setNavigationTrail(moved.trail)
      applyReaderNavigation(moved.location)
    },
    [applyReaderNavigation, currentReaderLocation, navigationTrail],
  )

  useEffect(() => {
    setNavigationTrail(emptyReaderNavigationTrail())
    exactNavigationRef.current = null
  }, [sourceKey])

  useEffect(() => {
    if (!visible || !keyboardActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,[contenteditable=true]')) return
      if (target?.closest('[role=menu],[role=dialog],[role=listbox],[role=tree]')) return
      if (speedReadingOpen) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        setPanelOpen(true)
        setSidePanel('search')
        return
      }
      if (event.shiftKey && event.key.toLocaleLowerCase() === 'a') {
        if (preferences.viewMode !== 'scroll') return
        event.preventDefault()
        if (autoScrollActive) stopAutoScroll()
        else {
          setAutoScrollActive(true)
          setAutoScrollPaused(false)
        }
        return
      }
      if (autoScrollActive && event.key === ' ') {
        event.preventDefault()
        setAutoScrollPaused((value) => !value)
        return
      }
      if (autoScrollActive && event.key === 'Escape') {
        event.preventDefault()
        stopAutoScroll()
        return
      }
      if (event.key === 'Escape' && panelOpen && narrowPane) {
        event.preventDefault()
        setPanelOpen(false)
        panelToggleRef.current?.focus({ preventScroll: true })
        return
      }
      if (event.key === 'Escape' && selection) {
        event.preventDefault()
        clearSelection()
        return
      }
      const historyDirection =
        event.altKey && event.key === 'ArrowLeft'
          ? 'back'
          : event.altKey && event.key === 'ArrowRight'
            ? 'forward'
            : (event.metaKey || event.ctrlKey) && event.key === '['
              ? 'back'
              : (event.metaKey || event.ctrlKey) && event.key === ']'
                ? 'forward'
                : null
      if (historyDirection) {
        event.preventDefault()
        moveNavigationHistory(historyDirection)
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      turnReadingPosition(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    autoScrollActive,
    clearSelection,
    keyboardActive,
    moveNavigationHistory,
    narrowPane,
    panelOpen,
    preferences.viewMode,
    selection,
    speedReadingOpen,
    stopAutoScroll,
    turnReadingPosition,
    visible,
  ])

  const attachAnnotationContext = (item: ReaderSavedQuote) => {
    if (!document) return
    const uri = readerChapterUri(source, item.chapter)
    pluginComposer.insert({
      sessionId,
      bindings: [
        resourceMessageBindingDraft({
          uri,
          label: `${displayBookTitle} · ${item.chapterTitle}`,
        }),
        snippetMessageBindingDraft({
          label: item.note ? `Note · ${item.chapterTitle}` : `Highlight · ${item.chapterTitle}`,
          content: item.note ? `${item.quote}\n\nNote: ${item.note}` : item.quote,
          language: 'text',
        }),
      ],
    })
  }

  const createAnnotation = (color: ReaderHighlightColor, editNote = false) => {
    if (!selectionTarget || !document || !chapter) return
    const id = saveQuote({
      id: crypto.randomUUID(),
      source,
      path: sourceKey,
      bookTitle: displayBookTitle,
      chapter: chapter.index,
      chapterTitle: chapter.title,
      quote: selectionTarget.quote,
      target: selectionTarget,
      color,
      note: '',
      createdAt: new Date().toISOString(),
    })
    if (preferences.highlightColor !== color) {
      setPreferences({ ...preferences, highlightColor: color })
    }
    setActiveAnnotationId(id)
    setEditingAnnotationId(editNote ? id : null)
    setPanelOpen(true)
    setSidePanel('saved')
    clearSelection()
  }

  const exportAnnotations = async () => {
    if (!document || !quotes.length) return
    const safeTitle = displayBookTitle.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/gu, '')
    const payload = {
      schema: 'localix.reader.annotations',
      version: 1,
      book: { title: displayBookTitle, author: displayBookAuthor, source },
      annotations: quotes,
      exportedAt: new Date().toISOString(),
    }
    try {
      // The host's save (a download or a desktop save) is its own confirmation.
      await pluginFiles.saveBlob(
        `${safeTitle || 'book'}-annotations.json`,
        new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json',
        }),
      )
    } catch (cause) {
      toast.error('Could not export annotations', {
        description: errorMessage(cause, '') || undefined,
      })
    }
  }

  const importAnnotations = async (file: File) => {
    if (!document) return
    try {
      const parsed = parseReaderAnnotationExport(JSON.parse(await file.text()))
      const portable = parsed
        .filter((item) => item.chapter < document.chapters.length)
        .map((item) => ({
          ...item,
          source,
          path: sourceKey,
          bookTitle: displayBookTitle,
          chapterTitle: document.chapters[item.chapter]?.title ?? item.chapterTitle,
        }))
      if (!portable.length) throw new Error('No annotations match chapters in this book')
      importQuotes(portable)
      // The saved panel opening on the imported notes is the confirmation.
      setPanelOpen(true)
      setSidePanel('saved')
    } catch (cause) {
      toast.error('Could not import annotations', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      if (annotationImportRef.current) annotationImportRef.current.value = ''
    }
  }

  const scheduleVisiblePassage = useCallback(
    (fraction: number) => {
      cancelAnimationFrame(visiblePassageFrameRef.current)
      visiblePassageFrameRef.current = requestAnimationFrame(() => {
        const article = articleRef.current
        const scroller = scrollRef.current
        if (!article || !scroller || !chapter) return
        setVisiblePassage(readerVisiblePassage(article, scroller, chapter.text, fraction))
      })
    },
    [chapter],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => scheduleVisiblePassage(scrollFraction))
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(visiblePassageFrameRef.current)
    }
  }, [
    chapter,
    preferences.fontSize,
    preferences.lineHeight,
    preferences.measure,
    preferences.viewMode,
    scheduleVisiblePassage,
    scrollFraction,
  ])

  const onScroll = () => {
    if (notePopover) closeNotePopover()
    const scroller = scrollRef.current
    if (!scroller) return
    const paginated = preferences.viewMode === 'page'
    const offset = paginated ? scroller.scrollLeft : scroller.scrollTop
    const scrollExtent = paginated ? scroller.scrollWidth : scroller.scrollHeight
    const viewportExtent = paginated ? scroller.clientWidth : scroller.clientHeight
    const fraction = readerViewportFraction(offset, scrollExtent, viewportExtent)
    setScrollFraction(fraction)
    setPagePosition(readerPagePosition(offset, scrollExtent, viewportExtent))
    syncPageTabStops()
    saveJSON(progressKey(sourceKey), {
      chapter: chapterIndex,
      fraction,
      chapterCount: document?.chapters.length,
    } satisfies ReaderProgress)
  }

  const startSpeedReading = () => {
    if (!speedTokens.length) return
    stopAutoScroll()
    setSpeedTokenIndex(readerSpeedStartIndex(speedTokens.length, scrollFraction))
    setSpeedReadingOpen(true)
    setSpeedReadingPlaying(true)
  }

  const stopSpeedReading = (returnToText = true) => {
    const fraction =
      speedTokens.length > 1
        ? Math.max(0, Math.min(1, speedTokenIndex / (speedTokens.length - 1)))
        : 0
    setSpeedReadingPlaying(false)
    setSpeedReadingOpen(false)
    if (!returnToText) return
    setScrollFraction(fraction)
    saveJSON(progressKey(sourceKey), {
      chapter: chapterIndex,
      fraction,
      chapterCount: document?.chapters.length,
    } satisfies ReaderProgress)
    requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (!scroller) return
      if (preferences.viewMode === 'page') {
        scroller.scrollLeft = readerPageOffsetAtFraction(
          fraction,
          scroller.scrollWidth,
          scroller.clientWidth,
        )
      } else {
        scroller.scrollTop = fraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      }
      speedReadingTriggerRef.current?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    if (
      !speedReadingOpen ||
      !speedReadingPlaying ||
      !visible ||
      !keyboardActive ||
      chapter?.index !== chapterIndex
    )
      return
    const token = speedTokens[speedTokenIndex]
    if (!token) return
    let timer = 0
    const advance = () => {
      if (globalThis.document.visibilityState === 'hidden') {
        timer = window.setTimeout(advance, 250)
        return
      }
      if (speedTokenIndex < speedTokens.length - 1) {
        setSpeedTokenIndex((value) => value + 1)
        return
      }
      if (document && chapterIndex < document.chapters.length - 1) {
        pendingChapterFractionRef.current = 0
        setSpeedTokenIndex(0)
        setChapterIndex((value) => value + 1)
        return
      }
      // Playback stops on the last word, visibly; a durable row would only repeat it.
      setSpeedReadingPlaying(false)
    }
    timer = window.setTimeout(
      advance,
      Math.round((60_000 / preferences.speedReadingWpm) * token.pauseFactor),
    )
    return () => window.clearTimeout(timer)
  }, [
    chapter?.index,
    chapterIndex,
    document,
    keyboardActive,
    preferences.speedReadingWpm,
    speedReadingOpen,
    speedReadingPlaying,
    speedTokenIndex,
    speedTokens,
    visible,
  ])

  const navigateToSearchMatch = (match: ReaderSearchMatch) => {
    setActiveSearchMatch(match.id)
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

  const openAnnotationEditor = (id: string | null) => {
    if (!id) return
    setActiveAnnotationId(id)
    setEditingAnnotationId(id)
    setPanelOpen(true)
    setSidePanel('saved')
  }

  const closeNotePopover = () => {
    noteRequestRef.current += 1
    setNotePopover((current) => {
      current?.origin.setAttribute('aria-expanded', 'false')
      return null
    })
  }

  const navigateToReaderFragment = (targetChapter: number, fragment: string) => {
    closeNotePopover()
    navigateReader({
      chapter: targetChapter,
      fraction: 0,
      ...(fragment ? { fragment } : {}),
    })
  }

  const openReaderExternal = (href: string) => {
    void Promise.resolve()
      .then(() => pluginExternal.open(href))
      .catch((cause) => {
        toast.error('Could not open the link', {
          description: errorMessage(cause, '') || undefined,
        })
      })
  }

  const openReaderNote = (anchor: HTMLAnchorElement): boolean => {
    const href = anchor.getAttribute('href')?.trim()
    if (!href) return false
    const strength = readerNoteReferenceStrength(anchor)
    if (!strength) return false
    const linkedChapter = Number(anchor.dataset.readerChapter)
    const targetChapter =
      Number.isInteger(linkedChapter) && linkedChapter >= 0 ? linkedChapter : loadedChapterIndex
    const fragment = anchor.dataset.readerFragment ?? (href.startsWith('#') ? href.slice(1) : '')
    if (!fragment) return false
    const chapterTitle = document?.chapters[targetChapter]?.title ?? chapter?.title ?? 'Book note'
    const rect = anchor.getBoundingClientRect()
    const base = {
      anchor: {
        x: Math.max(8, Math.min(globalThis.innerWidth - 8, rect.left)),
        y: Math.max(8, Math.min(globalThis.innerHeight - 8, rect.bottom)),
      },
      chapter: targetChapter,
      chapterTitle,
      fragment,
      origin: anchor,
    }
    if (targetChapter === loadedChapterIndex && articleRef.current) {
      const preview = readerNotePreview(articleRef.current, fragment, strength)
      if (!preview) return false
      noteRequestRef.current += 1
      setNotePopover((current) => {
        if (current?.origin !== anchor) current?.origin.setAttribute('aria-expanded', 'false')
        anchor.setAttribute('aria-haspopup', 'dialog')
        anchor.setAttribute('aria-expanded', 'true')
        return { ...base, status: 'ready', preview }
      })
      return true
    }
    if (strength !== 'definite') return false
    const request = noteRequestRef.current + 1
    noteRequestRef.current = request
    setNotePopover((current) => {
      if (current?.origin !== anchor) current?.origin.setAttribute('aria-expanded', 'false')
      anchor.setAttribute('aria-haspopup', 'dialog')
      anchor.setAttribute('aria-expanded', 'true')
      return { ...base, status: 'loading' }
    })
    void readerApi
      .chapter(source, targetChapter)
      .then(({ chapter: target }) => {
        if (noteRequestRef.current !== request) return
        if (target.kind !== 'html') throw new Error('This note is not available as rich text')
        const root = globalThis.document.createElement('article')
        root.innerHTML = sanitizeReaderHtml(target.content)
        const preview = readerNotePreview(root, fragment, strength)
        if (!preview) throw new Error('The linked note could not be located')
        setNotePopover((current) =>
          current?.origin === anchor ? { ...current, status: 'ready', preview } : current,
        )
      })
      .catch((cause) => {
        if (noteRequestRef.current !== request) return
        setNotePopover((current) =>
          current?.origin === anchor
            ? {
                ...current,
                status: 'error',
                error: cause instanceof Error ? cause.message : String(cause),
              }
            : current,
        )
      })
    return true
  }

  const attachNoteContext = () => {
    if (!document || !notePopover?.preview) return
    pluginComposer.insert({
      sessionId,
      bindings: [
        resourceMessageBindingDraft({
          uri: readerChapterUri(source, notePopover.chapter),
          label: `${displayBookTitle} · ${notePopover.chapterTitle}`,
        }),
        snippetMessageBindingDraft({
          label: `${notePopover.preview.title} · ${notePopover.chapterTitle}`,
          content: notePopover.preview.text,
          language: 'text',
        }),
      ],
    })
    // The chips landing in the composer are the confirmation.
  }

  const activateNoteLink = (anchor: HTMLAnchorElement) => {
    const target = readerLinkTarget(
      {
        href: anchor.getAttribute('href'),
        chapter: anchor.dataset.readerChapter,
        fragment: anchor.dataset.readerFragment,
      },
      notePopover?.chapter ?? loadedChapterIndex,
    )
    if (target.kind === 'external') {
      closeNotePopover()
      openReaderExternal(target.href)
    } else if (target.kind === 'internal') {
      navigateToReaderFragment(target.chapter, target.fragment)
    }
  }

  const activateArticleAnchor = (anchor: HTMLAnchorElement): boolean => {
    if (openReaderNote(anchor)) return true
    const target = readerLinkTarget(
      {
        href: anchor.getAttribute('href'),
        chapter: anchor.dataset.readerChapter,
        fragment: anchor.dataset.readerFragment,
      },
      loadedChapterIndex,
    )
    if (target.kind === 'internal') {
      navigateToReaderFragment(target.chapter, target.fragment)
      return true
    }
    if (target.kind === 'external') {
      openReaderExternal(target.href)
      return true
    }
    return false
  }

  const activateArticleLink = (event: ReactMouseEvent<HTMLElement>) => {
    if (readerLinkGesture(event) !== 'primary') return
    const target = event.target as Element | null
    const annotation = target?.closest<HTMLElement>('[data-reader-annotation-id]')
    if (annotation && articleRef.current?.contains(annotation)) {
      event.preventDefault()
      openAnnotationEditor(annotation.dataset.readerAnnotationId ?? null)
      return
    }
    const anchor = target?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || !articleRef.current?.contains(anchor)) return
    if (activateArticleAnchor(anchor)) {
      event.preventDefault()
      // `tauri-plugin-shell` injects a click listener on document.body that fires
      // for any `<a target="_blank">` — which is exactly what the sanitizer puts
      // on a book's external links — and calls `plugin:shell|open` WITHOUT
      // checking `defaultPrevented`. That command is deliberately not in this
      // app's capabilities, so the click also raised a denied invoke. React
      // listens inside body, so stopping here keeps that shim out of a click we
      // have already handled.
      event.stopPropagation()
    }
  }

  const activateArticleAuxLink = (event: ReactMouseEvent<HTMLElement>) => {
    if (readerLinkGesture(event) !== 'auxiliary') return
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || !articleRef.current?.contains(anchor)) return
    if (activateArticleAnchor(anchor)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const activateArticleAnnotationKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      preferences.focusMode === 'paragraph' &&
      ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    ) {
      const current = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-reader-focus-target="true"]',
      )
      const blocks = paragraphFocusBlocksRef.current
      const currentIndex = current ? blocks.indexOf(current) : -1
      if (currentIndex >= 0) {
        event.preventDefault()
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? blocks.length - 1
              : Math.max(
                  0,
                  Math.min(blocks.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)),
                )
        activateParagraphFocus(blocks[nextIndex] ?? null, true)
        return
      }
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const annotation = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-reader-annotation-id]',
    )
    if (!annotation || !articleRef.current?.contains(annotation)) return
    event.preventDefault()
    openAnnotationEditor(annotation.dataset.readerAnnotationId ?? null)
  }

  useEffect(() => {
    noteRequestRef.current += 1
    setNotePopover((current) => {
      current?.origin.setAttribute('aria-expanded', 'false')
      return null
    })
  }, [loadedChapterIndex, sourceKey])

  useEffect(() => {
    if (chapter?.kind !== 'html') return
    let noteAnchors: HTMLAnchorElement[] = []
    const frame = requestAnimationFrame(() => {
      const root = articleRef.current
      if (!root) return
      noteAnchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
        (anchor) => readerNoteReferenceStrength(anchor) === 'definite',
      )
      for (const anchor of noteAnchors) {
        anchor.setAttribute('aria-haspopup', 'dialog')
        anchor.setAttribute('aria-expanded', 'false')
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      for (const anchor of noteAnchors) {
        anchor.removeAttribute('aria-haspopup')
        anchor.removeAttribute('aria-expanded')
      }
    }
  }, [chapter])

  const changeViewMode = (viewMode: ReaderPreferences['viewMode']) => {
    if (viewMode === preferences.viewMode) return
    modeSwitchFractionRef.current = scrollFraction
    setPreferences({
      ...preferences,
      viewMode,
    })
  }

  const readerMargins =
    preferences.pageMargin === 'compact'
      ? { block: '1.5rem', inline: '1.25rem' }
      : preferences.pageMargin === 'roomy'
        ? { block: '3.5rem', inline: '3rem' }
        : { block: '2.5rem', inline: '2rem' }
  // Owned ABOVE the branches, so the row settles when the book finally opens instead of when the
  // branch that drew it stops rendering. `null` while the pane is healthy is what settles it.
  const openFailure = useReaderOpenFailure({
    sessionId,
    source,
    detail: errorDetail,
    message:
      loading && !chapter
        ? null
        : error && !chapter
          ? error
          : !document || !chapter
            ? 'Reader parsed this file but found no readable chapter.'
            : null,
    onBack: onBack ?? onClosePane,
    onRetry: () => {
      setError(null)
      setErrorDetail(null)
      setReloadToken((token) => token + 1)
    },
  })

  const articleStyle = {
    '--reader-font-size': preferences.fontSize,
    '--reader-line-height': preferences.lineHeight,
    '--reader-measure': preferences.measure,
    '--reader-margin-block': readerMargins.block,
    '--reader-margin-inline': readerMargins.inline,
  } as CSSProperties

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
  const turnLabel = pageDocument || preferences.viewMode === 'page' ? 'page' : 'chapter'
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
      <WorkbenchToolbar aria-label="Reader controls" as="header">
        <WorkbenchToolbarSection className="reader-toolbar-leading min-w-0 flex-1">
          {onClosePane && (
            <IconButton
              onClick={onClosePane}
              aria-label="Close parallel reader"
              tooltip="Close parallel reader"
            >
              <X />
            </IconButton>
          )}
          <IconButton
            ref={panelToggleRef}
            onClick={() => setPanelOpen((value) => !value)}
            aria-label={panelOpen ? 'Hide book panel' : 'Show book panel'}
            tooltip={panelOpen ? 'Hide book panel' : 'Show book panel'}
          >
            {panelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </IconButton>
          {onBack && (
            <IconButton onClick={onBack} aria-label="Back to library" tooltip="Back to library">
              <ArrowLeft />
            </IconButton>
          )}
          <div
            className="reader-toolbar-location min-w-0 flex-1 cursor-grab active:cursor-grabbing"
            draggable
            title="Drag this chapter to the agent"
            onDragStart={(event) => {
              if (!chapterResource) return
              const binding = resourceMessageBindingDraft(
                {
                  uri: chapterResource,
                  label: `${displayBookTitle} · ${chapter.title}`,
                },
                'drag',
              )
              setMessageBindingDrag(event.dataTransfer, binding, {
                previewLabel: `${displayBookTitle} · ${chapter.title}`,
                plainText: binding.target.token,
              })
            }}
          >
            {/* A stacked title duplicated the path below and exceeded the toolbar's measure.
                Keep the book and chapter in one bounded navigation line. */}
            <WorkbenchBreadcrumb aria-label="Reader path" className="reader-location-path">
              <li className="reader-location-book flex min-w-0 items-center">
                <BreadcrumbSelect
                  label={displayBookTitle}
                  items={libraryBooks.map((book) => {
                    const bookSource = sourceForBook(book)
                    return {
                      id: book.mediaId ? `media:${book.mediaId}` : `path:${book.path}`,
                      label: book.title,
                      description: `${book.author ? `${book.author} · ` : ''}${book.format.toUpperCase()}`,
                      icon: <BookCover book={book} compact />,
                      iconClassName:
                        'h-8 w-[1.375rem] rounded-xs border border-border bg-card opacity-100 shadow-(--shadow-raised)',
                      active: sourceStorageKey(bookSource) === sourceKey,
                      onSelect: () => onOpenBook(bookSource),
                    }
                  })}
                  ariaLabel="Switch book"
                  icon={<BookOpen className="size-3.5" aria-hidden="true" />}
                  searchPlaceholder="Search books"
                  onOpenChange={(open) => {
                    if (open) void refreshLibraryBooks()
                  }}
                  onSearchAll={onBack}
                  searchAllLabel="Open Reader library…"
                  className="w-full text-foreground"
                />
              </li>
              <li className="reader-location-chapter flex min-w-0 items-center gap-1">
                <ChevronRight className="size-2.5 shrink-0 text-text-faint" aria-hidden="true" />
                <BreadcrumbSelect
                  label={chapter.title}
                  items={document.chapters.map((item) => ({
                    id: item.id,
                    label: `${item.index + 1}. ${item.title}`,
                    active: item.index === chapterIndex,
                    onSelect: () => setChapterIndex(item.index),
                  }))}
                  ariaLabel="Switch chapter"
                  ariaCurrent="page"
                  className="w-full text-text-soft font-normal"
                />
              </li>
            </WorkbenchBreadcrumb>
          </div>
        </WorkbenchToolbarSection>
        <WorkbenchToolbarSection
          align="end"
          spacing="compact"
          aria-label="Reading actions"
          className="reader-toolbar-actions"
        >
          <IconButton
            aria-pressed={sidePanel === 'search'}
            onClick={() => {
              setPanelOpen(true)
              setSidePanel('search')
            }}
            aria-label="Search inside book"
            tooltip="Search inside book"
          >
            <Search />
          </IconButton>
          <IconButton
            onClick={() =>
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
            aria-label={isChapterBookmarked ? 'Remove chapter bookmark' : 'Bookmark chapter'}
            tooltip={isChapterBookmarked ? 'Remove bookmark' : 'Bookmark chapter'}
          >
            {isChapterBookmarked ? <BookmarkCheck /> : <Bookmark />}
          </IconButton>
          <ReaderAppearanceMenu preferences={preferences} onChange={setPreferences} />
          {(!fixedPageDocument || onParallelRead) && (
            <ReaderReadingToolsMenu
              triggerRef={speedReadingTriggerRef}
              fixedPageDocument={fixedPageDocument}
              viewMode={preferences.viewMode}
              focusMode={preferences.focusMode}
              autoScrollActive={autoScrollActive}
              autoScrollPaused={autoScrollPaused}
              speedReadingWpm={preferences.speedReadingWpm}
              speedReadingAvailable={Boolean(speedTokens.length)}
              parallelAvailable={Boolean(onParallelRead)}
              parallelActive={parallelActive}
              onViewModeChange={changeViewMode}
              onFocusModeChange={(focusMode) => setPreferences({ ...preferences, focusMode })}
              onToggleAutoScroll={() => {
                if (!autoScrollActive) {
                  setAutoScrollActive(true)
                  setAutoScrollPaused(false)
                } else {
                  setAutoScrollPaused((value) => !value)
                }
              }}
              onStopAutoScroll={stopAutoScroll}
              onStartSpeedReading={startSpeedReading}
              onToggleParallel={() => onParallelRead?.()}
            />
          )}
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <div className="relative flex min-h-0 flex-1">
        {panelOpen && (
          <button
            type="button"
            className="reader-toc-dismiss"
            aria-label="Close book panel"
            onClick={() => setPanelOpen(false)}
          />
        )}
        {panelOpen && (
          <aside
            className="reader-toc-panel z-(--z-overlay) flex w-72 shrink-0 flex-col border-r border-[var(--reader-rule)] bg-background"
            aria-label="Book navigation"
          >
            <div className="flex min-h-24 shrink-0 items-start gap-3 border-b border-[var(--reader-rule)] p-3">
              <div className="flex aspect-[2/3] h-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
                {currentBook ? (
                  <BookCover book={currentBook} />
                ) : (
                  <BookOpen
                    className="size-5 text-text-faint"
                    strokeWidth={1.4}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="line-clamp-2 text-xs/4 font-medium">{displayBookTitle}</div>
                <div className="mt-1 truncate text-2xs text-text-faint">
                  {displayBookAuthor || document.format.toUpperCase()}
                </div>
                <div className="mt-2 text-2xs tabular-nums text-text-faint">
                  {pageDocument
                    ? `${document.chapters.length} pages`
                    : `${document.chapters.length} chapters · ${document.wordCount.toLocaleString()} words`}
                </div>
              </div>
            </div>
            <PanelHeader
              tone="content"
              className="border-[var(--reader-rule)]"
              title={
                sidePanel === 'toc'
                  ? 'Contents'
                  : sidePanel === 'search'
                    ? 'Search'
                    : sidePanel === 'saved'
                      ? 'Annotations'
                      : sidePanel === 'bookmarks'
                        ? 'Bookmarks'
                        : 'Reading insights'
              }
              actions={
                sidePanel === 'saved' ? (
                  <>
                    <input
                      ref={annotationImportRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void importAnnotations(file)
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
                        onClick={() => void exportAnnotations()}
                        aria-label="Export annotations"
                        tooltip="Export annotations"
                      >
                        <Download />
                      </IconButton>
                    )}
                  </>
                ) : undefined
              }
            />
            <div
              className={
                sidePanel === 'search'
                  ? 'min-h-0 flex-1'
                  : 'min-h-0 flex-1 overflow-auto p-2 scrollbar-thin'
              }
              role="region"
              aria-label={
                sidePanel === 'toc'
                  ? 'Contents'
                  : sidePanel === 'search'
                    ? 'Book search'
                    : sidePanel === 'saved'
                      ? 'Annotations'
                      : sidePanel === 'bookmarks'
                        ? 'Bookmarks'
                        : 'Reading insights'
              }
            >
              {sidePanel === 'search' ? (
                <ReaderSearchPanel
                  source={source}
                  currentChapter={chapterIndex}
                  activeMatchId={activeSearchMatch}
                  onNavigate={navigateToSearchMatch}
                />
              ) : sidePanel === 'toc' ? (
                <div role="tree" aria-label="Table of contents">
                  {document.chapters.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="treeitem"
                      aria-level={1}
                      aria-selected={item.index === chapterIndex}
                      aria-current={item.index === chapterIndex ? 'location' : undefined}
                      tabIndex={tocFocusIndex === item.index ? 0 : -1}
                      data-reader-toc-index={item.index}
                      data-active={item.index === chapterIndex || undefined}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs text-text-soft outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring data-[active=true]:bg-surface-active data-[active=true]:font-medium data-[active=true]:text-foreground"
                      onFocus={() => setTocFocusIndex(item.index)}
                      onKeyDown={(event) => {
                        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                        event.preventDefault()
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? document.chapters.length - 1
                              : Math.max(
                                  0,
                                  Math.min(
                                    document.chapters.length - 1,
                                    item.index + (event.key === 'ArrowDown' ? 1 : -1),
                                  ),
                                )
                        setTocFocusIndex(next)
                        requestAnimationFrame(() =>
                          workspaceRef.current
                            ?.querySelector<HTMLButtonElement>(`[data-reader-toc-index="${next}"]`)
                            ?.focus(),
                        )
                      }}
                      onClick={() => {
                        setTocFocusIndex(item.index)
                        setChapterIndex(item.index)
                      }}
                    >
                      <span className="w-5 shrink-0 text-right text-2xs tabular-nums text-text-faint">
                        {item.index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-pretty">{item.title}</span>
                        {!pageDocument && (
                          <span className="mt-0.5 block text-2xs tabular-nums text-text-faint">
                            {readingMinutes(item.wordCount)} min
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ) : sidePanel === 'saved' && quotes.length ? (
                quotes.map((item) => (
                  <AnnotationCard
                    key={item.id}
                    item={item}
                    active={activeAnnotationId === item.id}
                    editing={editingAnnotationId === item.id}
                    onNavigate={() => {
                      setActiveAnnotationId(item.id)
                      setActiveSearchMatch(null)
                      setHighlightTarget(null)
                      requestAnimationFrame(() =>
                        setHighlightTarget(item.target ?? { quote: item.quote }),
                      )
                      setChapterIndex(item.chapter)
                    }}
                    onEdit={(editing) => setEditingAnnotationId(editing ? item.id : null)}
                    onChange={(patch) => updateQuote(item.id, patch)}
                    onRemove={() => {
                      removeQuote(item.id)
                      if (activeAnnotationId === item.id) setActiveAnnotationId(null)
                      if (editingAnnotationId === item.id) setEditingAnnotationId(null)
                    }}
                    onAddContext={() => attachAnnotationContext(item)}
                  />
                ))
              ) : sidePanel === 'bookmarks' && bookmarks.length ? (
                bookmarks.map((item) => (
                  <div
                    key={item.id}
                    className="group mb-1 rounded-md px-2 py-2 hover:bg-surface-hover"
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 text-left"
                      onClick={() => setChapterIndex(item.chapter)}
                    >
                      <Bookmark className="mt-0.5 size-3.5 shrink-0 text-text-faint" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs/5 text-text-soft">
                          {item.chapterTitle}
                        </span>
                        <span className="mt-0.5 block text-2xs text-text-faint">
                          Chapter {item.chapter + 1}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ml-5 mt-1 text-2xs text-text-faint opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={() => removeBookmark(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))
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
              )}
            </div>
            <div
              className="grid h-[var(--chrome-control-touch)] shrink-0 grid-cols-5 border-t border-[var(--reader-rule)] p-1"
              role="group"
              aria-label="Book panel view"
            >
              {/* `aria-pressed` alone marks the open tab: IconButton gives a pressed control the
                  shared engaged step, which the swapped `secondary` variant restated. */}
              <IconButton
                className="h-full w-full"
                onClick={() => setSidePanel('toc')}
                aria-pressed={sidePanel === 'toc'}
                aria-label="Contents"
                tooltip="Contents"
              >
                <ListTree />
              </IconButton>
              <IconButton
                className="h-full w-full"
                onClick={() => setSidePanel('search')}
                aria-pressed={sidePanel === 'search'}
                aria-label="Search inside book"
                tooltip="Search"
              >
                <Search />
              </IconButton>
              <IconButton
                className="relative h-full w-full"
                onClick={() => setSidePanel('saved')}
                aria-pressed={sidePanel === 'saved'}
                aria-label={`Annotations (${quotes.length})`}
                tooltip="Annotations"
              >
                <NotebookPen />
                {quotes.length > 0 && (
                  <span className="absolute right-2 top-1 text-3xs tabular-nums text-text-faint">
                    {quotes.length}
                  </span>
                )}
              </IconButton>
              <IconButton
                className="relative h-full w-full"
                onClick={() => setSidePanel('bookmarks')}
                aria-pressed={sidePanel === 'bookmarks'}
                aria-label={`Bookmarks (${bookmarks.length})`}
                tooltip="Bookmarks"
              >
                <Bookmark />
                {bookmarks.length > 0 && (
                  <span className="absolute right-2 top-1 text-3xs tabular-nums text-text-faint">
                    {bookmarks.length}
                  </span>
                )}
              </IconButton>
              <IconButton
                className="h-full w-full"
                onClick={() => setSidePanel('insights')}
                aria-pressed={sidePanel === 'insights'}
                aria-label="Reading insights"
                tooltip="Reading insights"
              >
                <BarChart3 />
              </IconButton>
            </div>
          </aside>
        )}
        <section
          ref={readerSurfaceRef}
          className="reader-reading-surface relative min-w-0 flex-1 bg-[var(--reader-paper)]"
          aria-label="Reading surface"
          data-focus-mode={preferences.focusMode}
          onPointerMove={(event) => {
            if (preferences.focusMode !== 'ruler') return
            const surface = readerSurfaceRef.current
            if (!surface) return
            const top = event.clientY - surface.getBoundingClientRect().top
            surface.style.setProperty('--reader-ruler-y', `${top}px`)
          }}
        >
          <div
            ref={scrollRef}
            className="reader-scroll h-full overflow-auto scrollbar-thin"
            data-view-mode={preferences.viewMode}
            data-page-margin={preferences.pageMargin}
            role="region"
            aria-label={`${displayBookTitle} — ${chapter.title} reading viewport`}
            aria-keyshortcuts={
              preferences.focusMode === 'paragraph'
                ? 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End'
                : 'ArrowLeft ArrowRight'
            }
            tabIndex={0}
            aria-hidden={speedReadingOpen || undefined}
            inert={speedReadingOpen || undefined}
            onPointerDown={() => {
              exactNavigationRef.current = null
            }}
            onWheel={() => {
              exactNavigationRef.current = null
            }}
            onScroll={() => {
              onScroll()
              statsTracker.markActivity()
              syncParagraphFocus()
            }}
          >
            <article
              ref={articleRef}
              key={`${sourceKey}:${chapter.index}`}
              className="reader-article"
              data-focus-mode={preferences.focusMode}
              data-font-family={preferences.fontFamily}
              data-text-align={preferences.textAlign}
              role="document"
              aria-label={`${displayBookTitle} — ${chapter.title}`}
              style={articleStyle}
              onPointerDown={onSelectionPointerDown}
              onPointerUp={onSelectionPointerUp}
              onPointerCancel={onSelectionPointerCancel}
              onKeyUp={onSelectionKeyUp}
              onKeyDown={activateArticleAnnotationKey}
              onClick={activateArticleLink}
              onAuxClick={activateArticleAuxLink}
            >
              <ChapterContent chapter={chapter} />
            </article>
          </div>
          {speedReadingOpen && speedTokens[speedTokenIndex] && (
            <div
              className="reader-speed-reading absolute inset-0 z-(--z-controls) flex flex-col bg-[var(--reader-paper)]"
              role="region"
              aria-label={`Speed reading — ${chapter.title}`}
              data-font-family={preferences.fontFamily}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  stopSpeedReading()
                  return
                }
                if (event.key === ' ') {
                  event.preventDefault()
                  setSpeedReadingPlaying((value) => !value)
                  return
                }
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  setSpeedReadingPlaying(false)
                  setSpeedTokenIndex((value) =>
                    Math.max(
                      0,
                      Math.min(
                        speedTokens.length - 1,
                        value + (event.key === 'ArrowRight' ? 1 : -1),
                      ),
                    ),
                  )
                  return
                }
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  setPreferences({
                    ...preferences,
                    speedReadingWpm: Math.max(
                      100,
                      Math.min(
                        600,
                        preferences.speedReadingWpm + (event.key === 'ArrowUp' ? 25 : -25),
                      ),
                    ),
                  })
                }
              }}
            >
              <WorkbenchToolbar
                as="header"
                aria-label="Speed reading"
                className="border-[var(--reader-rule)]"
              >
                <WorkbenchToolbarSection className="min-w-0 flex-1">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{chapter.title}</div>
                    <div className="text-2xs tabular-nums text-text-faint">
                      {preferences.speedReadingWpm} words/min
                    </div>
                  </div>
                </WorkbenchToolbarSection>
                <WorkbenchToolbarSection align="end">
                  <IconButton
                    onClick={() => stopSpeedReading()}
                    aria-label="Exit speed reading"
                    tooltip="Exit speed reading (Esc)"
                  >
                    <X />
                  </IconButton>
                </WorkbenchToolbarSection>
              </WorkbenchToolbar>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
                <div className="reader-speed-guide" aria-hidden="true" />
                <div className="reader-speed-word" aria-hidden="true">
                  <span>
                    {Array.from(speedTokens[speedTokenIndex]!.text)
                      .slice(0, speedTokens[speedTokenIndex]!.focusIndex)
                      .join('')}
                  </span>
                  <span className="text-[var(--reader-accent)]">
                    {Array.from(speedTokens[speedTokenIndex]!.text)[
                      speedTokens[speedTokenIndex]!.focusIndex
                    ] ?? ''}
                  </span>
                  <span>
                    {Array.from(speedTokens[speedTokenIndex]!.text)
                      .slice(speedTokens[speedTokenIndex]!.focusIndex + 1)
                      .join('')}
                  </span>
                </div>
                <span className="sr-only">
                  Visual speed reading mode. Use Space to pause, arrow keys to navigate or change
                  pace, and Escape to return to the book.
                </span>
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label="Speed reading controls"
                >
                  <IconButton
                    disabled={speedTokenIndex <= 0}
                    onClick={() => {
                      setSpeedReadingPlaying(false)
                      setSpeedTokenIndex((value) => Math.max(0, value - 1))
                    }}
                    aria-label="Previous word"
                    tooltip="Previous word (Left arrow)"
                  >
                    <ChevronLeft />
                  </IconButton>
                  <IconButton
                    emphasis="solid"
                    autoFocus
                    onClick={() => setSpeedReadingPlaying((value) => !value)}
                    aria-label={
                      speedReadingPlaying ? 'Pause speed reading' : 'Resume speed reading'
                    }
                    tooltip={speedReadingPlaying ? 'Pause (Space)' : 'Resume (Space)'}
                  >
                    {speedReadingPlaying ? <Pause /> : <Play />}
                  </IconButton>
                  <IconButton
                    disabled={speedTokenIndex >= speedTokens.length - 1}
                    onClick={() => {
                      setSpeedReadingPlaying(false)
                      setSpeedTokenIndex((value) => Math.min(speedTokens.length - 1, value + 1))
                    }}
                    aria-label="Next word"
                    tooltip="Next word (Right arrow)"
                  >
                    <ChevronRight />
                  </IconButton>
                </div>
              </div>
              <WorkbenchStatusBar
                aria-label="Speed reading status"
                className="border-[var(--reader-rule)]"
              >
                <WorkbenchStatusItem className="tabular-nums">
                  {speedTokenIndex + 1} / {speedTokens.length}
                </WorkbenchStatusItem>
                <WorkbenchStatusItem className="ml-auto">
                  Space pause · ↑↓ pace · Esc exit
                </WorkbenchStatusItem>
              </WorkbenchStatusBar>
            </div>
          )}
          {preferences.focusMode === 'ruler' && (
            <div className="reader-reading-ruler" aria-hidden="true" />
          )}
          {notePopover && (
            <ReaderNotePopover
              value={notePopover}
              onClose={closeNotePopover}
              onNavigate={() => navigateToReaderFragment(notePopover.chapter, notePopover.fragment)}
              onAddContext={attachNoteContext}
              onCopy={() => {
                if (notePopover.preview) void pluginClipboard.writeText(notePopover.preview.text)
              }}
              onLink={activateNoteLink}
            />
          )}
          {selectionTarget && (
            <ReaderSelectionToolbar
              ref={selectionToolbarRef}
              style={selectionToolbarStyle}
              placement={selectionToolbarPlacement}
              visible={selectionToolbarVisible}
              highlightColor={preferences.highlightColor}
              onHighlight={(color) => createAnnotation(color)}
              onNote={() => createAnnotation(preferences.highlightColor, true)}
              onCopy={() => void pluginClipboard.writeText(selection)}
              onClear={clearSelection}
            />
          )}
        </section>
      </div>
      <div className="h-0.5 shrink-0 bg-[var(--reader-rule)]" aria-hidden="true">
        <div className="h-full bg-[var(--reader-accent)]" style={{ width: `${wholeProgress}%` }} />
      </div>
      {/* `border-t-0`: the 2px progress track above IS this junction's seam, so the
          status bar must not draw a second rule under it. Together they used to render a 2px
          full-strength line stacked on a 1px `border-border/60` one. */}
      <WorkbenchStatusBar aria-label="Reading status" className="border-t-0">
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {pageDocument
            ? `Page ${loadedChapterIndex + 1} of ${document.chapters.length}`
            : `${chapter.title}. Chapter ${loadedChapterIndex + 1} of ${document.chapters.length}`}
          {!fixedPageDocument && preferences.viewMode === 'page'
            ? `. Reading page ${pagePosition.current} of ${pagePosition.total}`
            : ''}
        </span>
        <IconButton
          size="sm"
          className="h-full rounded-none"
          disabled={navigationTrail.past.length === 0}
          onClick={() => moveNavigationHistory('back')}
          aria-label="Back to previous reading location"
          tooltip="Back to previous reading location (Alt+Left or Mod+[)"
        >
          <Undo2 />
        </IconButton>
        <IconButton
          size="sm"
          className="h-full rounded-none"
          disabled={navigationTrail.future.length === 0}
          onClick={() => moveNavigationHistory('forward')}
          aria-label="Forward to next reading location"
          tooltip="Forward to next reading location (Alt+Right or Mod+])"
        >
          <Redo2 />
        </IconButton>
        <WorkbenchStatusItem>
          {pageDocument ? 'Page' : 'Chapter'} {loadedChapterIndex + 1} / {document.chapters.length}
        </WorkbenchStatusItem>
        {!fixedPageDocument && preferences.viewMode === 'page' && (
          <WorkbenchStatusItem>
            Page {pagePosition.current} / {pagePosition.total}
          </WorkbenchStatusItem>
        )}
        {!controlsCompact && !fixedPageDocument && (
          <WorkbenchStatusItem>
            {chapter.wordCount.toLocaleString()} words · {readingMinutes(chapter.wordCount)} min
          </WorkbenchStatusItem>
        )}
        {autoScrollActive && (
          <WorkbenchStatusItem>
            {autoScrollPaused
              ? 'Auto-scroll paused'
              : `Auto-scroll · ${preferences.autoScrollSpeed} px/s`}
          </WorkbenchStatusItem>
        )}
        {speedReadingOpen && (
          <WorkbenchStatusItem>
            Speed reading · {preferences.speedReadingWpm} wpm
          </WorkbenchStatusItem>
        )}
        <WorkbenchStatusItem className="ml-auto">{Math.round(wholeProgress)}%</WorkbenchStatusItem>
        <IconButton
          size="sm"
          className="h-full rounded-none"
          disabled={
            chapterIndex <= 0 && (preferences.viewMode !== 'page' || pagePosition.current <= 1)
          }
          onClick={() => turnReadingPosition(-1)}
          aria-label={`Previous ${turnLabel}`}
          tooltip={`Previous ${turnLabel}`}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          size="sm"
          className="h-full rounded-none"
          disabled={
            chapterIndex >= document.chapters.length - 1 &&
            (preferences.viewMode !== 'page' || pagePosition.current >= pagePosition.total)
          }
          onClick={() => turnReadingPosition(1)}
          aria-label={`Next ${turnLabel}`}
          tooltip={`Next ${turnLabel}`}
        >
          <ChevronRight />
        </IconButton>
      </WorkbenchStatusBar>
    </div>
  )
}
