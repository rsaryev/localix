import type { ReactNode } from 'react'
import { BarChart3, BookOpen, Bookmark, ListTree, NotebookPen, Search } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'

import type { ReaderBookSummary, ReaderDocument } from '../shared/contracts'
import { BookCover } from './readerParts'
import {
  readerSidePanelRegionLabel,
  readerSidePanelTitle,
  type ReaderSidePanel,
} from './readerPaneModel'

/** The book panel beside the page: identity, the open tab's body, and the tab strip. */
export function ReaderBookPanel({
  document,
  currentBook,
  displayBookTitle,
  displayBookAuthor,
  pageDocument,
  sidePanel,
  quoteCount,
  bookmarkCount,
  headerActions,
  onSidePanelChange,
  onDismiss,
  children,
}: {
  document: ReaderDocument
  currentBook: ReaderBookSummary | undefined
  displayBookTitle: string
  displayBookAuthor: string | undefined
  pageDocument: boolean
  sidePanel: ReaderSidePanel
  quoteCount: number
  bookmarkCount: number
  headerActions: ReactNode
  onSidePanelChange: (panel: ReaderSidePanel) => void
  onDismiss: () => void
  /** The open tab's body. */
  children: ReactNode
}) {
  return (
    <>
      <button
        type="button"
        className="reader-toc-dismiss"
        aria-label="Close book panel"
        onClick={onDismiss}
      />
      <aside
        className="reader-toc-panel z-(--z-overlay) flex w-72 shrink-0 flex-col border-r border-[var(--reader-rule)] bg-background"
        aria-label="Book navigation"
      >
        <div className="flex min-h-24 shrink-0 items-start gap-3 border-b border-[var(--reader-rule)] p-3">
          <div className="flex aspect-[2/3] h-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
            {currentBook ? (
              <BookCover book={currentBook} />
            ) : (
              <BookOpen className="size-5 text-text-faint" strokeWidth={1.4} aria-hidden="true" />
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
          title={readerSidePanelTitle(sidePanel)}
          actions={headerActions}
        />
        <div
          className={
            sidePanel === 'search'
              ? 'min-h-0 flex-1'
              : 'min-h-0 flex-1 overflow-auto p-2 scrollbar-thin'
          }
          role="region"
          aria-label={readerSidePanelRegionLabel(sidePanel)}
        >
          {children}
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
            onClick={() => onSidePanelChange('toc')}
            aria-pressed={sidePanel === 'toc'}
            aria-label="Contents"
            tooltip="Contents"
          >
            <ListTree />
          </IconButton>
          <IconButton
            className="h-full w-full"
            onClick={() => onSidePanelChange('search')}
            aria-pressed={sidePanel === 'search'}
            aria-label="Search inside book"
            tooltip="Search"
          >
            <Search />
          </IconButton>
          <IconButton
            className="relative h-full w-full"
            onClick={() => onSidePanelChange('saved')}
            aria-pressed={sidePanel === 'saved'}
            aria-label={`Annotations (${quoteCount})`}
            tooltip="Annotations"
          >
            <NotebookPen />
            {quoteCount > 0 && (
              <span className="absolute right-2 top-1 text-3xs tabular-nums text-text-faint">
                {quoteCount}
              </span>
            )}
          </IconButton>
          <IconButton
            className="relative h-full w-full"
            onClick={() => onSidePanelChange('bookmarks')}
            aria-pressed={sidePanel === 'bookmarks'}
            aria-label={`Bookmarks (${bookmarkCount})`}
            tooltip="Bookmarks"
          >
            <Bookmark />
            {bookmarkCount > 0 && (
              <span className="absolute right-2 top-1 text-3xs tabular-nums text-text-faint">
                {bookmarkCount}
              </span>
            )}
          </IconButton>
          <IconButton
            className="h-full w-full"
            onClick={() => onSidePanelChange('insights')}
            aria-pressed={sidePanel === 'insights'}
            aria-label="Reading insights"
            tooltip="Reading insights"
          >
            <BarChart3 />
          </IconButton>
        </div>
      </aside>
    </>
  )
}
