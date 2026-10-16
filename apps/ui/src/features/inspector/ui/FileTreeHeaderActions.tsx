import {
  ChevronsDownUp,
  ClipboardPaste,
  FilePlus,
  FolderPlus,
  MoreHorizontal,
  RefreshCw,
  Search as SearchIcon,
  X,
} from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { fileTreeOptionsEntries } from './fileTreeOptionsMenu'

interface FileTreeHeaderActionsProps {
  searchVisible: boolean
  openSearch: () => void
  closeSearch: () => void
  contentMode: boolean
  content: { hasResults: boolean; collapseAll: () => void }
  root: string | null
  hasClipboard: boolean
  hasExpanded: boolean
  live: boolean
  refreshing: boolean
  compactEnabled: boolean
  toggleCompactEnabled: () => void
  startCreate: (parent: string, type: 'file' | 'dir') => unknown
  pasteInto: (dir: string) => unknown
  collapseAll: () => void
  loadRoot: () => unknown
}

/** The Explorer header buttons: search toggle, then content-search or tree actions. */
export function FileTreeHeaderActions({
  searchVisible,
  openSearch,
  closeSearch,
  contentMode,
  content,
  root,
  hasClipboard,
  hasExpanded,
  live,
  refreshing,
  compactEnabled,
  toggleCompactEnabled,
  startCreate,
  pasteInto,
  collapseAll,
  loadRoot,
}: FileTreeHeaderActionsProps) {
  return (
    <>
      <IconButton
        size="sm"
        aria-label={searchVisible ? 'Hide search' : 'Search files'}
        tooltip={searchVisible ? 'Hide search' : 'Search files'}
        tooltipSide="bottom"
        aria-pressed={searchVisible}
        className={searchVisible ? 'text-foreground' : undefined}
        onClick={() => (searchVisible ? closeSearch() : openSearch())}
      >
        <SearchIcon className="size-3.5" />
      </IconButton>
      {contentMode ? (
        <>
          <IconButton
            size="sm"
            aria-label="Collapse all results"
            tooltip="Collapse all results"
            tooltipSide="bottom"
            disabled={!content.hasResults}
            onClick={content.collapseAll}
          >
            <ChevronsDownUp className="size-3.5" />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Clear search"
            tooltip="Clear search"
            tooltipSide="bottom"
            onClick={closeSearch}
          >
            <X className="size-3.5" />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton
            size="sm"
            aria-label="New file"
            tooltip="New file"
            tooltipSide="bottom"
            disabled={!root}
            onClick={() => root && void startCreate(root, 'file')}
          >
            <FilePlus className="size-3.5" />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="New folder"
            tooltip="New folder"
            tooltipSide="bottom"
            disabled={!root}
            onClick={() => root && void startCreate(root, 'dir')}
          >
            <FolderPlus className="size-3.5" />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Paste into project root"
            tooltip="Paste into project root"
            tooltipSide="bottom"
            disabled={!root || !hasClipboard}
            onClick={() => root && void pasteInto(root)}
          >
            <ClipboardPaste className="size-3.5" />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Collapse all"
            tooltip="Collapse all"
            tooltipSide="bottom"
            onClick={collapseAll}
            disabled={!hasExpanded}
          >
            <ChevronsDownUp className="size-3.5" />
          </IconButton>
          {/* A live tree follows disk by itself; Refresh exists only where it cannot
              (an ssh/docker workspace, a watcher that failed). */}
          {!live && (
            <IconButton
              size="sm"
              aria-label="Refresh"
              tooltip="Refresh"
              tooltipSide="bottom"
              onClick={() => loadRoot()}
            >
              {refreshing ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            </IconButton>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                aria-label="File tree options"
                tooltip="More options"
                tooltipSide="bottom"
              >
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <MenuEntries
                family="dropdown"
                entries={fileTreeOptionsEntries({ compactEnabled, toggleCompactEnabled })}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </>
  )
}
