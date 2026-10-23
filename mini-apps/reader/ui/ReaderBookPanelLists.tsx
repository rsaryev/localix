import type { RefObject } from 'react'
import { Bookmark } from 'lucide-react'

import type { ReaderDocument } from '../shared/contracts'
import type { ReaderBookmark } from './model'
import { isReaderListKey, readerListKeyIndex } from './readerPaneModel'
import { readingMinutes } from './readerStorage'

/** The contents tab: a roving-tabindex tree of chapters. */
export function ReaderTocTree({
  document,
  chapterIndex,
  focusIndex,
  pageDocument,
  workspaceRef,
  onFocusIndexChange,
  onSelectChapter,
}: {
  document: ReaderDocument
  chapterIndex: number
  focusIndex: number
  pageDocument: boolean
  workspaceRef: RefObject<HTMLDivElement | null>
  onFocusIndexChange: (index: number) => void
  onSelectChapter: (index: number) => void
}) {
  return (
    <div role="tree" aria-label="Table of contents">
      {document.chapters.map((item) => (
        <button
          key={item.id}
          type="button"
          role="treeitem"
          aria-level={1}
          aria-selected={item.index === chapterIndex}
          aria-current={item.index === chapterIndex ? 'location' : undefined}
          tabIndex={focusIndex === item.index ? 0 : -1}
          data-reader-toc-index={item.index}
          data-active={item.index === chapterIndex || undefined}
          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs text-text-soft outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring data-[active=true]:bg-surface-active data-[active=true]:font-medium data-[active=true]:text-foreground"
          onFocus={() => onFocusIndexChange(item.index)}
          onKeyDown={(event) => {
            if (!isReaderListKey(event.key)) return
            event.preventDefault()
            const next = readerListKeyIndex(event.key, item.index, document.chapters.length)
            onFocusIndexChange(next)
            requestAnimationFrame(() =>
              workspaceRef.current
                ?.querySelector<HTMLButtonElement>(`[data-reader-toc-index="${next}"]`)
                ?.focus(),
            )
          }}
          onClick={() => {
            onFocusIndexChange(item.index)
            onSelectChapter(item.index)
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
  )
}

/** The bookmarks tab: one row per bookmarked chapter, with a hover-revealed remove. */
export function ReaderBookmarkList({
  bookmarks,
  onSelectChapter,
  onRemove,
}: {
  bookmarks: ReaderBookmark[]
  onSelectChapter: (index: number) => void
  onRemove: (id: string) => void
}) {
  return bookmarks.map((item) => (
    <div key={item.id} className="group mb-1 rounded-md px-2 py-2 hover:bg-surface-hover">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => onSelectChapter(item.chapter)}
      >
        <Bookmark className="mt-0.5 size-3.5 shrink-0 text-text-faint" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-xs/5 text-text-soft">{item.chapterTitle}</span>
          <span className="mt-0.5 block text-2xs text-text-faint">Chapter {item.chapter + 1}</span>
        </span>
      </button>
      <button
        type="button"
        className="ml-5 mt-1 text-2xs text-text-faint opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={() => onRemove(item.id)}
      >
        Remove
      </button>
    </div>
  ))
}
