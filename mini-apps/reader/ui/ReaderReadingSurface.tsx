import type { CSSProperties, RefObject } from 'react'
import { miniAppClipboard } from '@localixai/mini-app-sdk/ui/runtime'

import type { ReaderChapter } from '../shared/contracts'
import type { ReaderPreferences } from './model'
import { ChapterContent } from './readerParts'
import { readerPageMargins } from './readerPaneModel'
import { ReaderNotePopover } from './ReaderNotePopover'
import { ReaderSelectionToolbar } from './ReaderSelectionToolbar'
import { ReaderSpeedReadingOverlay } from './ReaderSpeedReadingOverlay'
import type { useReaderAnnotationActions } from './useReaderAnnotationActions'
import type { useReaderArticleLinks } from './useReaderArticleLinks'
import type { useReaderNotes } from './useReaderNotes'
import type { ReaderPosition } from './useReaderPosition'
import type { useReaderSpeedReading } from './useReaderSpeedReading'
import type { useReaderTextSelection } from './useReaderTextSelection'

export interface ReaderSurfaceRefs {
  surface: RefObject<HTMLElement | null>
  scroll: RefObject<HTMLDivElement | null>
  article: RefObject<HTMLElement | null>
}

/** The open chapter itself, and what is drawn over it. */
export interface ReaderSurfaceReading {
  sourceKey: string
  displayBookTitle: string
  chapter: ReaderChapter
  preferences: ReaderPreferences
  setPreferences: (next: ReaderPreferences) => void
}

/** The hooks the surface draws from, passed whole rather than as loose callbacks. */
export interface ReaderSurfaceTools {
  position: Pick<ReaderPosition, 'exactNavigationRef'>
  textSelection: ReturnType<typeof useReaderTextSelection>
  links: ReturnType<typeof useReaderArticleLinks>
  notes: ReturnType<typeof useReaderNotes>
  speed: ReturnType<typeof useReaderSpeedReading>
  annotations: ReturnType<typeof useReaderAnnotationActions>
}

/** The person's own hand takes over from a jump to an exact place: it is no longer owed. */
function forgetExactNavigation(exact: { current: unknown }) {
  exact.current = null
}

/** The scrolled reading viewport with its article, overlays, ruler, note popover and toolbar. */
export function ReaderReadingSurface({
  refs,
  reading,
  tools,
  onScroll,
}: {
  refs: ReaderSurfaceRefs
  reading: ReaderSurfaceReading
  tools: ReaderSurfaceTools
  onScroll: () => void
}) {
  const { sourceKey, displayBookTitle, chapter, preferences, setPreferences } = reading
  const { position, textSelection, links, notes, speed, annotations } = tools
  const { selection, selectionTarget, clearSelection } = textSelection
  const { notePopover, closeNotePopover } = notes
  const readerMargins = readerPageMargins(preferences.pageMargin)
  const articleStyle = {
    '--reader-font-size': preferences.fontSize,
    '--reader-line-height': preferences.lineHeight,
    '--reader-measure': preferences.measure,
    '--reader-margin-block': readerMargins.block,
    '--reader-margin-inline': readerMargins.inline,
  } as CSSProperties

  return (
    <section
      ref={refs.surface}
      className="reader-reading-surface relative min-w-0 flex-1 bg-[var(--reader-paper)]"
      aria-label="Reading surface"
      data-focus-mode={preferences.focusMode}
      onPointerMove={(event) => {
        if (preferences.focusMode !== 'ruler') return
        const surface = refs.surface.current
        if (!surface) return
        const top = event.clientY - surface.getBoundingClientRect().top
        surface.style.setProperty('--reader-ruler-y', `${top}px`)
      }}
    >
      <div
        // oxlint-disable-next-line react/refs -- the scroll container's own ref, handed in by the pane that reads its scroll position; it is only attached here, never read while rendering
        ref={refs.scroll}
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
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container made focusable so the keyboard can page through the chapter
        tabIndex={0}
        aria-hidden={speed.speedReadingOpen || undefined}
        inert={speed.speedReadingOpen || undefined}
        onPointerDown={() => forgetExactNavigation(position.exactNavigationRef)}
        onWheel={() => forgetExactNavigation(position.exactNavigationRef)}
        onScroll={onScroll}
      >
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- delegated events: selection, links and annotation keys arrive from the text inside; the article is the one place that reads them */}
        <article
          ref={refs.article}
          key={`${sourceKey}:${chapter.index}`}
          className="reader-article"
          data-focus-mode={preferences.focusMode}
          data-font-family={preferences.fontFamily}
          data-text-align={preferences.textAlign}
          role="document"
          aria-label={`${displayBookTitle} — ${chapter.title}`}
          style={articleStyle}
          onPointerDown={textSelection.onSelectionPointerDown}
          onPointerUp={textSelection.onSelectionPointerUp}
          onPointerCancel={textSelection.onSelectionPointerCancel}
          onKeyUp={textSelection.onSelectionKeyUp}
          onKeyDown={links.activateArticleAnnotationKey}
          onClick={links.activateArticleLink}
          onAuxClick={links.activateArticleAuxLink}
        >
          <ChapterContent chapter={chapter} />
        </article>
      </div>
      {speed.speedReadingOpen && (
        <ReaderSpeedReadingOverlay
          chapterTitle={chapter.title}
          preferences={preferences}
          setPreferences={setPreferences}
          tokens={speed.speedTokens}
          tokenIndex={speed.speedTokenIndex}
          setTokenIndex={speed.setSpeedTokenIndex}
          playing={speed.speedReadingPlaying}
          setPlaying={speed.setSpeedReadingPlaying}
          onExit={() => speed.stopSpeedReading()}
        />
      )}
      {preferences.focusMode === 'ruler' && (
        <div className="reader-reading-ruler" aria-hidden="true" />
      )}
      {notePopover && (
        <ReaderNotePopover
          value={notePopover}
          onClose={closeNotePopover}
          onNavigate={() =>
            links.navigateToReaderFragment(notePopover.chapter, notePopover.fragment)
          }
          onAddContext={notes.attachNoteContext}
          onCopy={() => {
            if (notePopover.preview) void miniAppClipboard.writeText(notePopover.preview.text)
          }}
          onLink={links.activateNoteLink}
        />
      )}
      {selectionTarget && (
        <ReaderSelectionToolbar
          ref={textSelection.selectionToolbarRef}
          // oxlint-disable-next-line react/refs -- the hook's result holds the toolbar's ref (only attached above, never read while rendering), so the rule takes every field of it for a ref read; `style` is plain data
          style={textSelection.selectionToolbarStyle}
          placement={textSelection.selectionToolbarPlacement}
          visible={textSelection.selectionToolbarVisible}
          highlightColor={preferences.highlightColor}
          onHighlight={(color) => annotations.createAnnotation(color)}
          onNote={() => annotations.createAnnotation(preferences.highlightColor, true)}
          onCopy={() => void miniAppClipboard.writeText(selection)}
          onClear={clearSelection}
        />
      )}
    </section>
  )
}
