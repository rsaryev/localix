import { memo, useEffect, useState } from 'react'
import { BookOpen, MessageSquareText, PenLine, Search, Trash2, X } from 'lucide-react'
import { SegmentedRadioGroup } from '@localixai/plugin-sdk/ui'

import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { MarkdownRenderer } from '@localixai/kit/markdown'
import { StateNotice } from '@localixai/kit/state-notice'
import { Textarea } from '@localixai/kit/textarea'

import type {
  ReaderChapter,
  ReaderBookSummary,
  ReaderLibrarySearchResponse,
  ReaderSource,
} from '../shared/contracts'
import {
  READER_HIGHLIGHT_COLORS,
  sanitizeReaderHtml,
  type ReaderLibrarySort,
  type ReaderSavedQuote,
  type ReaderTextTarget,
} from './model'
import { READER_HIGHLIGHT_COLOR_LABELS, ReaderHighlightSwatch } from './ReaderSelectionToolbar'
import { sourceForBook } from './readerSources'
import './reader.css'

/**
 * The Reader's small presentational pieces — a cover, an annotation card, a search
 * result list, a rendered chapter.
 *
 * None of them holds state that outlives a render, and none is interesting alone; what they are is
 * the vocabulary the two panes are written in. Carved out of `ReaderWorkspace.tsx` (4,386 lines),
 * where they sat between two thousand-line screens.
 */
export function BookCover({
  book,
  compact = false,
}: {
  book: ReaderBookSummary
  compact?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [book.cover])
  if (book.cover && !failed) {
    return (
      <img
        src={book.cover}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }
  const initials = book.title
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase()
  if (compact) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-card text-2xs font-semibold text-text-soft">
        {initials || <BookOpen className="size-3" strokeWidth={1.4} aria-hidden="true" />}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col justify-between bg-card p-4 text-foreground">
      <BookOpen className="size-5 text-text-faint" strokeWidth={1.4} aria-hidden="true" />
      <div>
        <div className="text-2xl font-semibold tracking-tight text-text-soft">{initials}</div>
        <div className="mt-2 line-clamp-3 text-xs/4 font-medium">{book.title}</div>
      </div>
      <div className="text-2xs tracking-wide text-text-faint uppercase">{book.format}</div>
    </div>
  )
}

export const LIBRARY_SORT_LABELS: Record<ReaderLibrarySort, string> = {
  recent: 'Recently opened',
  title: 'Title',
  progress: 'Reading progress',
  format: 'Format',
}

export function AnnotationCard({
  item,
  active,
  editing,
  onNavigate,
  onEdit,
  onChange,
  onRemove,
  onAddContext,
}: {
  item: ReaderSavedQuote
  active: boolean
  editing: boolean
  onNavigate: () => void
  onEdit: (editing: boolean) => void
  onChange: (patch: Partial<Pick<ReaderSavedQuote, 'color' | 'note'>>) => void
  onRemove: () => void
  onAddContext: () => void
}) {
  const [draft, setDraft] = useState(item.note ?? '')
  useEffect(() => setDraft(item.note ?? ''), [item.id, item.note])
  const color = item.color ?? 'yellow'

  return (
    <div
      className="reader-annotation-card group mb-1 rounded-md border border-transparent p-2 transition-colors hover:bg-surface-hover data-[active=true]:border-[var(--reader-rule)] data-[active=true]:bg-surface-active"
      data-active={active || undefined}
    >
      <div className="flex items-start gap-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onNavigate}>
          <span className="flex items-start gap-2">
            <ReaderHighlightSwatch color={color} />
            <span className="line-clamp-3 text-xs/5 text-text-soft">“{item.quote}”</span>
          </span>
          {item.note && !editing && (
            <span className="mt-1.5 line-clamp-2 border-l border-[var(--reader-rule)] pl-2 text-2xs/4 text-foreground">
              {item.note}
            </span>
          )}
          <span className="mt-1 block truncate text-2xs text-text-faint">{item.chapterTitle}</span>
        </button>
        <IconButton
          size="sm"
          className="-mr-1 -mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={() => onEdit(!editing)}
          aria-label={editing ? 'Close note editor' : 'Edit annotation'}
          tooltip={editing ? 'Close editor' : 'Edit annotation'}
        >
          {editing ? <X /> : <PenLine />}
        </IconButton>
      </div>
      {editing && (
        <div className="mt-2 border-t border-[var(--reader-rule)] pt-2">
          <SegmentedRadioGroup
            className="mb-2 h-auto gap-1 bg-transparent p-0"
            aria-label="Highlight color"
            variant="ghost"
            value={color}
            onValueChange={(next) => onChange({ color: next })}
            options={READER_HIGHLIGHT_COLORS.map((nextColor) => ({
              value: nextColor,
              label: <ReaderHighlightSwatch color={nextColor} />,
              title: READER_HIGHLIGHT_COLOR_LABELS[nextColor],
              'aria-label': READER_HIGHLIGHT_COLOR_LABELS[nextColor],
              className: 'reader-highlight-choice size-7 rounded-md px-0 hover:bg-surface-hover',
            }))}
          />
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a note…"
            aria-label="Annotation note"
            autoFocus
          />
          <div className="mt-2 flex items-center gap-1">
            <IconButton
              size="sm"
              onClick={onAddContext}
              aria-label="Add annotation to agent"
              tooltip="Add to agent"
            >
              <MessageSquareText />
            </IconButton>
            <IconButton
              size="sm"
              tone="danger"
              onClick={onRemove}
              aria-label="Delete annotation"
              tooltip="Delete annotation"
            >
              <Trash2 />
            </IconButton>
            <Button
              variant="mono"
              size="sm"
              className="ml-auto"
              onClick={() => {
                onChange({ note: draft.trim() })
                onEdit(false)
              }}
            >
              Save note
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function LibrarySearchResults({
  books,
  content,
  loading,
  onOpen,
}: {
  books: ReaderBookSummary[]
  content: ReaderLibrarySearchResponse | null
  loading: boolean
  onOpen: (source: ReaderSource, chapter?: number, target?: ReaderTextTarget) => void
}) {
  if (loading && !content) return <LoadingHint>Searching your shelf…</LoadingHint>
  if (!books.length && !content?.hits.length) {
    return (
      <StateNotice
        icon={Search}
        title="No matching books or passages"
        body="Try a different phrase. Reader searches only books you explicitly opened."
      />
    )
  }
  return (
    <div className="space-y-6">
      {books.length > 0 && (
        <section aria-labelledby="reader-title-matches">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="reader-title-matches" className="text-xs font-medium">
              Books
            </h2>
            <span className="text-2xs tabular-nums text-text-faint">{books.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2">
            {books.map((book) => (
              <button
                key={book.mediaId ? `media:${book.mediaId}` : `path:${book.path}`}
                type="button"
                className="flex min-h-12 items-center gap-3 rounded-md border border-border px-3 py-2 text-left outline-none hover:bg-surface-hover focus-ring"
                onClick={() => onOpen(sourceForBook(book))}
              >
                <BookOpen className="size-4 shrink-0 text-text-faint" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{book.title}</span>
                  <span className="block truncate text-2xs text-text-faint">{book.path}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {content?.hits.length ? (
        <section aria-labelledby="reader-passage-matches">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="reader-passage-matches" className="text-xs font-medium">
              Passages
            </h2>
            <span className="text-2xs tabular-nums text-text-faint">
              {content.total}
              {content.truncated ? '+' : ''}
            </span>
          </div>
          <div className="divide-y divide-border-soft border-y border-border-soft">
            {content.hits.map(({ book, match }) => (
              <button
                key={`${book.mediaId ?? book.path}:${match.id}`}
                type="button"
                className="reader-search-result block min-h-14 w-full px-2 py-3 text-left outline-none hover:bg-surface-hover focus-ring"
                onClick={() =>
                  onOpen(sourceForBook(book), match.chapter, {
                    quote: match.match,
                    before: match.before,
                    after: match.after,
                  })
                }
              >
                <span className="block text-xs/5 text-text-soft">
                  {match.before && <span className="text-text-faint">…{match.before} </span>}
                  <mark>{match.match}</mark>
                  {match.after && <span className="text-text-faint"> {match.after}…</span>}
                </span>
                <span className="mt-1 block truncate text-2xs text-text-faint">
                  {book.title} · {match.chapterTitle}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

/**
 * Which shelf the library is filtered to. `all` and `unfiled` are not collection ids —
 * modelling them as bare strings alongside one let a real id shadow either sentinel.
 */
export type ReaderShelfFilter =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'collection'; id: string }

/** Stable identities, so re-selecting the same sentinel is a no-op re-render. */
export const SHELF_ALL: ReaderShelfFilter = { kind: 'all' }
export const SHELF_UNFILED: ReaderShelfFilter = { kind: 'unfiled' }

export const ChapterContent = memo(function ChapterContent({
  chapter,
}: {
  chapter: ReaderChapter
}) {
  if (chapter.kind === 'markdown') {
    return <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
  }
  if (chapter.kind === 'html') {
    return <div dangerouslySetInnerHTML={{ __html: sanitizeReaderHtml(chapter.content) }} />
  }
  return <div className="whitespace-pre-wrap">{chapter.content}</div>
})
