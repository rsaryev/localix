import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BookOpen, Ellipsis, Folder, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { resourceMessageBindingDraft, type MenuEntry } from '@localixai/plugin-sdk/ui'
import { setMessageBindingDrag } from '@localixai/plugin-sdk/ui/message-binding-drag'
import { Checkbox } from '@localixai/kit/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'

import type { ReaderBookSummary, ReaderSource } from '../shared/contracts'
import { readerBookUri } from '../shared/resource-uri'
import { bookFormatLine, libraryGridKeyIndex } from './libraryPaneModel'
import { BookCover } from './readerParts'
import { readerBookKey, sourceForBook, storedBookProgress } from './readerSources'

const GRID_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

/** The book gallery: a roving-tabindex grid of covers with per-book actions. */
export function ReaderLibraryGallery({
  books,
  focusedBookKey,
  selectionMode,
  selectedBookKeys,
  onFocusedBookKeyChange,
  onOpen,
  onToggleBook,
  onEditDetails,
  onEditCollections,
  onRemove,
}: {
  books: ReaderBookSummary[]
  focusedBookKey: string | null
  selectionMode: boolean
  selectedBookKeys: Set<string>
  onFocusedBookKeyChange: (key: string | null) => void
  onOpen: (source: ReaderSource) => void
  onToggleBook: (key: string) => void
  onEditDetails: (book: ReaderBookSummary) => void
  onEditCollections: (book: ReaderBookSummary) => void
  onRemove: (book: ReaderBookSummary) => void
}) {
  const libraryGridRef = useRef<HTMLDivElement>(null)

  const moveLibraryFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, key: string) => {
    if (!GRID_KEYS.includes(event.key)) return
    const buttons = Array.from(
      libraryGridRef.current?.querySelectorAll<HTMLButtonElement>('[data-reader-book-key]') ?? [],
    )
    const currentIndex = buttons.findIndex((button) => button.dataset.readerBookKey === key)
    if (currentIndex < 0) return
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    const centres = buttons.map((button) => {
      if (!vertical) return { x: 0, y: 0 }
      const rect = button.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    const nextIndex = libraryGridKeyIndex(event.key, currentIndex, centres) ?? currentIndex
    const next = buttons[nextIndex]
    if (!next || nextIndex === currentIndex) return
    event.preventDefault()
    onFocusedBookKeyChange(next.dataset.readerBookKey ?? null)
    next.focus()
  }

  const firstKey = books[0] ? readerBookKey(books[0]) : null

  return (
    <div
      ref={libraryGridRef}
      className="reader-library-grid grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-7"
      role="list"
      aria-label="Book gallery"
    >
      {books.map((book) => {
        const source = sourceForBook(book)
        const percent = storedBookProgress(book)
        const key = readerBookKey(book)
        const selected = selectedBookKeys.has(key)
        const toggleSelection = () => onToggleBook(key)
        // One list, two ways in: the cover's hover kebab and a right-click on the card.
        const bookActions: MenuEntry[] = [
          { id: 'open', label: 'Open', icon: BookOpen, onSelect: () => onOpen(source) },
          {
            id: 'details',
            label: 'Edit details',
            icon: Pencil,
            onSelect: () => onEditDetails(book),
          },
          {
            id: 'collections',
            label: 'Collections',
            icon: Folder,
            onSelect: () => onEditCollections(book),
          },
          {
            id: 'select',
            label: selected ? 'Deselect' : 'Select',
            icon: ListChecks,
            onSelect: toggleSelection,
          },
          { separator: true },
          {
            id: 'remove',
            label: 'Remove from library',
            icon: Trash2,
            danger: true,
            onSelect: () => onRemove(book),
          },
        ]
        return (
          <ContextMenu key={key}>
            <ContextMenuTrigger asChild>
              <article className="group relative min-w-0" role="listitem">
                {selectionMode && (
                  <span className="absolute left-2 top-2 z-(--z-controls) flex size-7 items-center justify-center rounded-md bg-popover/95 shadow-(--shadow-raised)">
                    <Checkbox
                      checked={selected}
                      onChange={toggleSelection}
                      aria-label={`${selected ? 'Deselect' : 'Select'} ${book.title}`}
                    />
                  </span>
                )}
                <button
                  type="button"
                  draggable={!selectionMode}
                  data-reader-book-key={key}
                  tabIndex={(focusedBookKey ?? firstKey) === key ? 0 : -1}
                  aria-pressed={selectionMode ? selected : undefined}
                  className="block w-full text-left outline-none focus-ring"
                  onClick={() => (selectionMode ? toggleSelection() : onOpen(source))}
                  onFocus={() => onFocusedBookKeyChange(key)}
                  onKeyDown={(event) => moveLibraryFocus(event, key)}
                  onDragStart={(event) => {
                    if (selectionMode) {
                      event.preventDefault()
                      return
                    }
                    const binding = resourceMessageBindingDraft(
                      { uri: readerBookUri(source), label: book.title },
                      'drag',
                    )
                    setMessageBindingDrag(event.dataTransfer, binding, {
                      previewLabel: book.title,
                      plainText: binding.target.token,
                    })
                  }}
                >
                  <span
                    className={`reader-book-cover relative block aspect-[2/3] overflow-hidden rounded-md border bg-card transition-colors group-hover:border-border-strong ${
                      selected ? 'border-foreground/50 ring-2 ring-foreground/25' : 'border-border'
                    }`}
                  >
                    <BookCover book={book} />
                    {percent > 0 && (
                      <span className="absolute inset-x-0 bottom-0 h-1 bg-background/70">
                        <span
                          className="block h-full bg-[var(--reader-accent)]"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    )}
                  </span>
                  <span className="mt-2 block truncate text-xs font-medium">{book.title}</span>
                  {book.author && (
                    <span className="mt-0.5 block truncate text-2xs text-text-soft">
                      {book.author}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-2xs text-text-faint">
                    {bookFormatLine(book)}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      size="sm"
                      className="absolute right-1 top-1 bg-popover/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      aria-label={`Book actions for ${book.title}`}
                    >
                      <Ellipsis />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <MenuEntries entries={bookActions} family="dropdown" />
                  </DropdownMenuContent>
                </DropdownMenu>
              </article>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <MenuEntries entries={bookActions} family="context" />
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}
