import { Folder, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'

import type { ReaderSource } from '../shared/contracts'
import type { ReaderSavedQuote, ReaderTextTarget } from './model'
import { ReaderHighlightSwatch } from './ReaderSelectionToolbar'
import { sourceFromSaved } from './readerSources'

/** The annotations view: every saved passage across books, each reopening at its place. */
export function ReaderLibrarySavedGrid({
  items,
  onOpen,
}: {
  items: ReaderSavedQuote[]
  onOpen: (source: ReaderSource, chapter?: number, highlight?: ReaderTextTarget) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
      {items.map((item) => {
        const source = sourceFromSaved(item)
        return (
          <button
            key={item.id}
            type="button"
            disabled={!source}
            onClick={() =>
              source && onOpen(source, item.chapter, item.target ?? { quote: item.quote })
            }
            className="rounded-lg border border-border bg-card p-4 text-left outline-none transition-colors hover:bg-surface-hover focus-ring disabled:opacity-50"
          >
            <span className="flex items-start gap-2">
              <ReaderHighlightSwatch color={item.color ?? 'yellow'} />
              <span className="line-clamp-4 text-sm/6 text-text-soft">“{item.quote}”</span>
            </span>
            {item.note && (
              <span className="mt-3 line-clamp-3 block border-l border-border pl-3 text-xs/5 text-foreground">
                {item.note}
              </span>
            )}
            <span className="mt-3 block truncate text-xs font-medium">
              {item.bookTitle ?? 'Book'}
            </span>
            <span className="mt-0.5 block truncate text-2xs text-text-faint">
              {item.chapterTitle}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The bar under the gallery while books are being selected. */
export function ReaderLibrarySelectionBar({
  selectedCount,
  visibleCount,
  shelfFullySelected,
  onExit,
  onToggleShelf,
  onCollections,
  onEditDetails,
  onRemove,
}: {
  selectedCount: number
  visibleCount: number
  shelfFullySelected: boolean
  onExit: () => void
  onToggleShelf: () => void
  onCollections: () => void
  onEditDetails: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex min-h-[var(--panel-header-height)] shrink-0 items-center gap-2 border-t border-border-soft bg-background px-3 py-1.5">
      <IconButton
        size="sm"
        onClick={onExit}
        aria-label="Exit book selection"
        tooltip="Exit selection"
      >
        <X />
      </IconButton>
      <span className="min-w-0 truncate text-xs font-medium tabular-nums">
        {selectedCount} selected
      </span>
      <Button variant="ghost" size="sm" onClick={onToggleShelf} disabled={!visibleCount}>
        {shelfFullySelected ? 'Clear shelf' : 'Select shelf'}
      </Button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onCollections} disabled={!selectedCount}>
          <Folder data-icon="inline-start" />
          <span className="hidden @sm:inline">Collections</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onEditDetails} disabled={selectedCount !== 1}>
          <Pencil data-icon="inline-start" />
          <span className="hidden @sm:inline">Edit details</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-status-error hover:text-status-error"
          onClick={onRemove}
          disabled={!selectedCount}
        >
          <Trash2 data-icon="inline-start" />
          <span className="hidden @sm:inline">Remove</span>
        </Button>
      </div>
    </div>
  )
}
