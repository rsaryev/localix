import { ChevronLeft, ChevronRight, Redo2, Undo2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'

import type { ReaderChapter, ReaderDocument } from '../shared/contracts'
import type { ReaderNavigationTrail, ReaderPreferences } from './model'
import { readingMinutes } from './readerStorage'

/** The whole-book progress track and the reading status bar beneath it. */
export function ReaderPaneStatusBar({
  document,
  chapter,
  chapterIndex,
  loadedChapterIndex,
  pagePosition,
  preferences,
  wholeProgress,
  pageDocument,
  fixedPageDocument,
  controlsCompact,
  navigationTrail,
  autoScrollActive,
  autoScrollPaused,
  speedReadingOpen,
  onMoveHistory,
  onTurn,
}: {
  document: ReaderDocument
  chapter: ReaderChapter
  chapterIndex: number
  loadedChapterIndex: number
  pagePosition: { current: number; total: number }
  preferences: ReaderPreferences
  wholeProgress: number
  pageDocument: boolean
  fixedPageDocument: boolean
  controlsCompact: boolean
  navigationTrail: ReaderNavigationTrail
  autoScrollActive: boolean
  autoScrollPaused: boolean
  speedReadingOpen: boolean
  onMoveHistory: (direction: 'back' | 'forward') => void
  onTurn: (direction: -1 | 1) => void
}) {
  const turnLabel = pageDocument || preferences.viewMode === 'page' ? 'page' : 'chapter'
  return (
    <>
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
          onClick={() => onMoveHistory('back')}
          aria-label="Back to previous reading location"
          tooltip="Back to previous reading location (Alt+Left or Mod+[)"
        >
          <Undo2 />
        </IconButton>
        <IconButton
          size="sm"
          className="h-full rounded-none"
          disabled={navigationTrail.future.length === 0}
          onClick={() => onMoveHistory('forward')}
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
          onClick={() => onTurn(-1)}
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
          onClick={() => onTurn(1)}
          aria-label={`Next ${turnLabel}`}
          tooltip={`Next ${turnLabel}`}
        >
          <ChevronRight />
        </IconButton>
      </WorkbenchStatusBar>
    </>
  )
}
