import {
  ArrowUpDown,
  BookOpen,
  Folder,
  Grid2X2,
  Library,
  ListChecks,
  NotebookPen,
} from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

import type { ReaderLibraryResponse } from '../shared/contracts'
import type { ReaderLibrarySort } from './model'
import {
  LIBRARY_SORT_LABELS,
  SHELF_ALL,
  SHELF_UNFILED,
  type ReaderShelfFilter,
} from './readerParts'

export type ReaderLibraryView = 'books' | 'saved'

/** The library's identity row: search, sort, open and refresh. */
export function ReaderLibraryHeader({
  view,
  query,
  sort,
  loading,
  onQueryChange,
  onSortChange,
  onChooseBook,
  onRefresh,
}: {
  view: ReaderLibraryView
  query: string
  sort: ReaderLibrarySort
  loading: boolean
  onQueryChange: (query: string) => void
  onSortChange: (sort: ReaderLibrarySort) => void
  onChooseBook: () => void
  onRefresh: () => void
}) {
  return (
    <WorkbenchToolbar aria-label="Reader library controls" as="header">
      <WorkbenchToolbarSection className="min-w-0 flex-1">
        <Library className="size-4 text-text-faint" strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">Reader</div>
          <div className="truncate text-2xs text-text-faint">
            {view === 'books' ? 'Library' : 'Annotations'}
          </div>
        </div>
      </WorkbenchToolbarSection>
      <WorkbenchToolbarSection align="end">
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          placeholder={view === 'books' ? 'Search library' : 'Search annotations'}
          aria-label={view === 'books' ? 'Search reader library' : 'Search annotations'}
          size="md"
          className="hidden w-48 @sm:flex"
        />
        {view === 'books' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Sort books" tooltip="Sort books">
                <ArrowUpDown />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <MenuEntries
                entries={[
                  { header: 'Sort books' },
                  ...(
                    Object.entries(LIBRARY_SORT_LABELS) as Array<[ReaderLibrarySort, string]>
                  ).map(([value, label]) => ({
                    id: value,
                    label,
                    selected: value === sort,
                    onSelect: () => onSortChange(value),
                  })),
                ]}
                family="dropdown"
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="ghost" size="sm" onClick={onChooseBook}>
          <BookOpen data-icon="inline-start" /> Open book
        </Button>
        <RefreshAction
          size="md"
          tooltip="Refresh library"
          aria-label="Refresh library"
          disabled={loading}
          busy={loading}
          onClick={onRefresh}
        />
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}

/** The library's second row: books/annotations view, shelf filter and selection mode. */
export function ReaderLibraryViewBar({
  view,
  result,
  savedCount,
  activeCollection,
  activeCollectionLabel,
  selectionMode,
  onViewChange,
  onCollectionChange,
  onManageCollections,
  onToggleSelectionMode,
}: {
  view: ReaderLibraryView
  result: ReaderLibraryResponse | null
  savedCount: number
  activeCollection: ReaderShelfFilter
  activeCollectionLabel: string
  selectionMode: boolean
  onViewChange: (view: ReaderLibraryView) => void
  onCollectionChange: (shelf: ReaderShelfFilter) => void
  onManageCollections: () => void
  onToggleSelectionMode: () => void
}) {
  return (
    // `density="compact"`: this is the SECOND bar of the library's chrome stack. At the
    // default density it repeated the identity row's 36px measure, so the two read as one
    // doubled band instead of a header and the view/scope row under it. Compact is the
    // primitive's "secondary controls" step, and it is the same header-then-compact-row
    // junction the API navigator (RestApiSidebar) and the Database explorer already use.
    <WorkbenchToolbar aria-label="Library view" density="compact">
      <WorkbenchToolbarSection spacing="compact">
        <Button
          variant={view === 'books' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('books')}
          aria-pressed={view === 'books'}
        >
          <Grid2X2 data-icon="inline-start" /> Books
          <span className="text-text-faint">{result?.books.length ?? 0}</span>
        </Button>
        <Button
          variant={view === 'saved' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('saved')}
          aria-pressed={view === 'saved'}
        >
          <NotebookPen data-icon="inline-start" /> Annotations
          <span className="text-text-faint">{savedCount}</span>
        </Button>
      </WorkbenchToolbarSection>
      {view === 'books' && (
        <WorkbenchToolbarSection align="end" spacing="compact" className="min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={activeCollection.kind === 'all' ? 'ghost' : 'secondary'}
                size="sm"
                className="max-w-48"
                aria-label={`Shelf: ${activeCollectionLabel}`}
              >
                <Folder data-icon="inline-start" />
                <span className="truncate">{activeCollectionLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <MenuEntries
                entries={[
                  { header: 'Collections' },
                  {
                    id: 'all',
                    label: 'All books',
                    selected: activeCollection.kind === 'all',
                    onSelect: () => onCollectionChange(SHELF_ALL),
                  },
                  {
                    id: 'unfiled',
                    label: 'Unfiled',
                    selected: activeCollection.kind === 'unfiled',
                    onSelect: () => onCollectionChange(SHELF_UNFILED),
                  },
                  { separator: true },
                  ...(result?.collections ?? []).map((collection) => ({
                    id: `collection:${collection.id}`,
                    label: collection.name,
                    hint: String(
                      result?.books.filter((book) => book.collectionIds?.includes(collection.id))
                        .length ?? 0,
                    ),
                    selected:
                      activeCollection.kind === 'collection' &&
                      activeCollection.id === collection.id,
                    onSelect: () => onCollectionChange({ kind: 'collection', id: collection.id }),
                  })),
                  { separator: true },
                  {
                    id: 'manage',
                    label: 'Manage collections…',
                    onSelect: onManageCollections,
                  },
                ]}
                family="dropdown"
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant={selectionMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleSelectionMode}
            disabled={(result?.books.length ?? 0) === 0}
            aria-pressed={selectionMode}
          >
            <ListChecks data-icon="inline-start" /> Select
          </Button>
        </WorkbenchToolbarSection>
      )}
    </WorkbenchToolbar>
  )
}
