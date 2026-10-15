import type { RefObject } from 'react'
import { Filter, Text } from 'lucide-react'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { TreeSearchMode } from '@/shared/lib/explorerBus'
import { Toggle as ModeToggle } from './search/SearchTreeView'

interface FileTreeSearchBarProps {
  rowRef: RefObject<HTMLDivElement | null>
  mode: TreeSearchMode
  setMode: (mode: TreeSearchMode) => void
  query: string
  setQuery: (query: string) => void
  onClose: () => void
}

/** The Explorer's one search field with its find-in-files / filter-by-name mode toggle. */
export function FileTreeSearchBar({
  rowRef,
  mode,
  setMode,
  query,
  setQuery,
  onClose,
}: FileTreeSearchBarProps) {
  return (
    <WorkbenchToolbar
      ref={rowRef}
      density="compact"
      tone="sidebar"
      aria-label="File search controls"
      className="gap-1 px-2"
    >
      <SearchInput
        value={query}
        onValueChange={setQuery}
        inset
        size="md"
        autoFocus
        placeholder={mode === 'names' ? 'Filter files by name' : 'Search in files'}
        aria-label={mode === 'names' ? 'Filter files by name' : 'Search in files'}
        className="min-w-0 flex-1"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <WorkbenchToolbarSection spacing="compact" aria-label="Search mode">
        <ModeToggle
          active={mode === 'content'}
          onClick={() => setMode('content')}
          title="Search in file contents"
        >
          <Text className="size-3" />
        </ModeToggle>
        <ModeToggle
          active={mode === 'names'}
          onClick={() => setMode('names')}
          title="Filter files by name"
        >
          <Filter className="size-3" />
        </ModeToggle>
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}
