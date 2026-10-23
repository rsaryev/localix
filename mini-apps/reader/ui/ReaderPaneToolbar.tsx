import type { ReactNode, RefObject } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react'
import { resourceMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import { setMessageBindingDrag } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { IconButton } from '@localixai/kit/icon-button'
import { BreadcrumbSelect } from '@localixai/kit/breadcrumb-select'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

import type {
  ReaderBookSummary,
  ReaderChapter,
  ReaderDocument,
  ReaderSource,
} from '../shared/contracts'
import { BookCover } from './readerParts'
import { sourceForBook, sourceStorageKey } from './readerSources'

/** The reading pane's header: pane controls, the book › chapter path, and reading actions. */
export function ReaderPaneToolbar({
  document,
  chapter,
  chapterIndex,
  chapterResource,
  displayBookTitle,
  libraryBooks,
  sourceKey,
  panelOpen,
  panelToggleRef,
  searchOpen,
  chapterBookmarked,
  onClosePane,
  onTogglePanel,
  onBack,
  onOpenBook,
  onRefreshLibrary,
  onSelectChapter,
  onOpenSearch,
  onToggleBookmark,
  children,
}: {
  document: ReaderDocument
  chapter: ReaderChapter
  chapterIndex: number
  chapterResource: string | null
  displayBookTitle: string
  libraryBooks: ReaderBookSummary[]
  sourceKey: string
  panelOpen: boolean
  panelToggleRef: RefObject<HTMLButtonElement | null>
  searchOpen: boolean
  chapterBookmarked: boolean
  onClosePane?: () => void
  onTogglePanel: () => void
  onBack?: () => void
  onOpenBook: (source: ReaderSource) => void
  onRefreshLibrary: () => void
  onSelectChapter: (index: number) => void
  onOpenSearch: () => void
  onToggleBookmark: () => void
  /** The appearance and reading-tools menus, after the bookmark action. */
  children: ReactNode
}) {
  return (
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
          onClick={onTogglePanel}
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
                  if (open) onRefreshLibrary()
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
                  onSelect: () => onSelectChapter(item.index),
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
          aria-pressed={searchOpen}
          onClick={onOpenSearch}
          aria-label="Search inside book"
          tooltip="Search inside book"
        >
          <Search />
        </IconButton>
        <IconButton
          onClick={onToggleBookmark}
          aria-label={chapterBookmarked ? 'Remove chapter bookmark' : 'Bookmark chapter'}
          tooltip={chapterBookmarked ? 'Remove bookmark' : 'Bookmark chapter'}
        >
          {chapterBookmarked ? <BookmarkCheck /> : <Bookmark />}
        </IconButton>
        {children}
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}
