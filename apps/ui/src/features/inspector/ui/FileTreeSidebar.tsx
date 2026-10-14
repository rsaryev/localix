import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { toast } from '@/shared/lib/notify'
import {
  ChevronsDownUp,
  RefreshCw,
  FilePlus,
  FolderPlus,
  ClipboardPaste,
  Search as SearchIcon,
  Filter,
  Text,
  X,
  MoreHorizontal,
} from 'lucide-react'
import { PanelHeader } from '@localixai/kit/panel-header'
import { IconButton } from '@localixai/kit/icon-button'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { subscribeNewFile } from '@/shared/lib/explorerBus'
import { ContentSearchView } from './search/ContentSearchView'
import { Toggle as ModeToggle } from './search/SearchTreeView'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { useKeybindingMatcher } from '@/shared/lib/keybindings'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { useChatStore } from '@/features/chat/model/store'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { createTypeahead } from '@localixai/kit/tree-navigation'
import { useFileTree, type PendingDelete } from './useFileTree'
import { revealScrollIndex } from './fileTreeReveal'
import { fileTreeRootMenu } from './fileTreeRootMenu'
import { useFileTreeDecorations, useFileTreeScopeKey } from '@/shared/contrib/fileTreeDecorations'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@localixai/kit/dropdown-menu'
import { fileTreeOptionsEntries } from './fileTreeOptionsMenu'
import { selectedComparePathForSession, useCompareSelection } from '../model/compareSelection'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { ProblemLine } from '@/shared/ui/problem-report'
import { Spinner } from '@localixai/kit/spinner'
import { useTreeSearch } from './useTreeSearch'
import { useTreeDnd } from './useTreeDnd'
import type { TreeRowOps } from './treeRowOps'
import { FileTreeEntries } from './FileTreeEntries'
import {
  fileTreeEntryRows,
  fileTreeNavigation,
  flattenFileTreeRows,
  type FileTreeNavigationKey,
} from './fileTreeRows'
import type { VisibleRow } from './fileTreePaths'
import { DROP_TARGET_INSET_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'

const copy = (text: string, label: string) => void copyText(text, label)

/** Confirm-dialog copy for a pending single- or multi-row delete. `permanent`
 *  distinguishes the reversible move-to-trash (default) from a Shift+Delete that
 *  removes the entry for good. (Remote sessions have no local trash and
 *  always delete permanently — noted here so the copy never over-promises undo.) */
function describeDeletion(
  targets: PendingDelete[],
  permanent: boolean,
): { title?: string; description?: string } {
  if (targets.length === 0) return {}
  const tail = permanent ? 'This cannot be undone.' : 'It will move to Trash — you can undo this.'
  if (targets.length === 1) {
    const t = targets[0]
    return {
      title:
        t.type === 'dir'
          ? permanent
            ? 'Delete folder permanently?'
            : 'Delete folder?'
          : permanent
            ? 'Delete file permanently?'
            : 'Delete file?',
      description: `“${t.name}”${t.type === 'dir' ? ' and its contents' : ''} will be ${permanent ? 'permanently deleted' : 'moved to Trash'}. ${tail}`,
    }
  }
  const hasDir = targets.some((t) => t.type === 'dir')
  return {
    title: permanent
      ? `Delete ${targets.length} items permanently?`
      : `Delete ${targets.length} items?`,
    description: `${targets.length} items${hasDir ? ' (including folder contents)' : ''} will be ${permanent ? 'permanently deleted' : 'moved to Trash'}. ${tail}`,
  }
}

/** Lazy project file tree. Directories load their children on first expand; files open in the inspector panel. */
export function FileTreeSidebar() {
  const sessionId = useChatStore((s) => s.activeSessionId)
  // Remount at BOTH ownership boundaries: the workspace owning the tree's paths, selection, edit
  // dialog and clipboard, and the decoration provider, whose `useIndex` is a runtime-chosen hook.
  const scope = useFileTreeScopeKey(sessionId)
  return <SessionFileTreeSidebar key={scope} sessionId={sessionId} />
}

function SessionFileTreeSidebar({ sessionId }: { sessionId: string | null }) {
  const matchesKey = useKeybindingMatcher()
  const {
    activeFilePath,
    root,
    childrenByPath,
    truncatedByPath,
    expanded,
    loading,
    problem,
    refreshing,
    live,
    edit,
    editError,
    pendingDelete,
    setPendingDelete,
    selected,
    selectRow,
    clearSelection,
    requestDelete,
    deletePermanent,
    duplicate,
    undoLast,
    clipboard,
    clip,
    pasteInto,
    dropEntries,
    revealRequest,
    loadRoot,
    toggle,
    collapseAll,
    compactEnabled,
    toggleCompactEnabled,
    toggleCompact,
    expandCompactAt,
    startCreate,
    startRename,
    cancelEdit,
    submitEdit,
    confirmDelete,
    reveal,
    isSessionCurrent,
  } = useFileTree(sessionId)

  // Directory-row toggle: fold-aware when compaction is on (cascades a single-child
  // chain open in one click), plain expand/collapse otherwise.
  const doToggleDir = compactEnabled ? toggleCompact : toggle

  // Row decorations: a letter beside a changed file + a dot on
  // folders containing one, so you see what an agent touched without opening its panel. CONTRIBUTED
  // — the tree knows a letter, a colour and a tooltip, never what makes a file interesting. Nothing
  // registered means every lookup returns undefined and the tree renders plain rows.
  const decorations = useFileTreeDecorations(sessionId)
  // "Select for Compare" pick — drives the "Compare with Selected" menu item.
  const compareSelectedPath = useCompareSelection((s) =>
    selectedComparePathForSession(s.selectedSessionId, s.selectedPath, sessionId),
  )

  // Right-click "add to the ignore list" — the provider owns where that list lives, which entry a
  // path becomes in it, and the success wording. The tree owns only the failure the provider cannot
  // see: the session moved on while the write was in flight, so the toast would name the wrong one.
  const addToIgnore = decorations.addToIgnore
  const runAddToIgnore = addToIgnore
    ? (full: string, isDir: boolean) => {
        void addToIgnore(full, isDir).catch((e) => {
          if (isSessionCurrent())
            toast.error('Could not update the ignore list', {
              description: errorMessage(e, '') || undefined,
            })
        })
      }
    : undefined
  const deleteConfirm = describeDeletion(pendingDelete ?? [], deletePermanent)

  // One field, two modes (find-in-files vs filter-loaded-tree-by-name). See useTreeSearch.
  // Destructured (not held as one object) so the react-compiler lint can tell the ref
  // apart from the plain values — a ref reached through an object reads as a render-time
  // ref access.
  const {
    mode: searchMode,
    setMode: setSearchMode,
    visible: searchVisible,
    contentMode,
    query,
    setQuery,
    filter,
    content,
    rowRef: searchRowRef,
    openSearch,
    close: closeSearch,
  } = useTreeSearch(sessionId, root, childrenByPath)
  const filterQuery = filter ? query : ''

  // In-tree move/copy: the drag protocol (multi-selection payload, Alt = copy, the
  // dragover-can't-read-getData workaround). See useTreeDnd.
  const dnd = useTreeDnd(new Set(selected.keys()), dropEntries)

  // Native File ▸ New File → start an inline new-file entry at the project root
  // (same flow as the header's New File button). No-op until the root has loaded.
  useEffect(
    () =>
      subscribeNewFile(() => {
        if (root) void startCreate(root, 'file')
      }),
    [root, startCreate],
  )

  // The operations every tree row supports — one vocabulary, consumed by both the
  // folder and file rows for their context menu AND their key bindings. See treeRowOps.
  const rowOps = useMemo<TreeRowOps>(
    () => ({
      startRename,
      duplicate,
      clip,
      pasteInto,
      reveal,
      addToIgnore: runAddToIgnore,
      ignoreLabel: decorations.ignoreLabel,
      requestDelete,
      undoLast,
      copyText: copy,
      clipboard,
      selected: new Set(selected.keys()),
      root,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runAddToIgnore closes over the listed session-currency check.
    [
      startRename,
      duplicate,
      clip,
      pasteInto,
      reveal,
      requestDelete,
      undoLast,
      clipboard,
      selected,
      root,
      runAddToIgnore,
      decorations.ignoreLabel,
      isSessionCurrent,
    ],
  )

  // The background menu's entries — the root's own actions, which are exactly the header
  // buttons. See `fileTreeRootMenu` for why it is described rather than written as JSX.
  // Not memoized: the React Compiler owns that, and a hand-written dep list here would be one
  // more thing to keep in step with the builder's arguments.
  const rootMenu = fileTreeRootMenu({
    root,
    hasClipboard: Boolean(clipboard),
    hasExpanded: expanded.size > 0,
    startCreate,
    pasteInto,
    refresh: loadRoot,
    collapseAll,
    reveal,
    copyText: copy,
  })

  // One flat layout is authoritative for render order and every interaction that
  // used to query all mounted DOM rows. That is what makes bounded rendering safe:
  // rows outside the viewport remain navigable, revealable, and range-selectable.
  const rows = useMemo(
    () =>
      root
        ? flattenFileTreeRows({
            root,
            childrenByPath,
            truncatedByPath,
            expanded,
            loading,
            edit,
            filter,
            compactEnabled,
          })
        : [],
    [root, childrenByPath, truncatedByPath, expanded, loading, edit, filter, compactEnabled],
  )
  const entryRows = useMemo(() => fileTreeEntryRows(rows), [rows])
  const rootIsEmpty =
    rows.length === 1 &&
    rows[0]?.kind === 'status' &&
    rows[0].status === 'empty' &&
    rows[0].depth === 0
  const entryOrder = useMemo<VisibleRow[]>(
    () => entryRows.map(({ path, name, type }) => ({ path, name, type })),
    [entryRows],
  )
  const layoutIndexByPath = useMemo(() => {
    const indexes = new Map<string, number>()
    rows.forEach((row, index) => {
      if (row.kind === 'entry') indexes.set(row.path, index)
    })
    return indexes
  }, [rows])

  // Roving focus still makes the tree one Tab stop. Unlike the shared DOM-based
  // helper, its validity comes from the complete model and the active row is
  // pinned by rangeExtractor even while it is outside the viewport.
  const [rememberedRovingPath, setRememberedRovingPath] = useState<string | null>(null)
  const rovingPath =
    rememberedRovingPath && layoutIndexByPath.has(rememberedRovingPath)
      ? rememberedRovingPath
      : (entryRows[0]?.path ?? null)
  const tabIndexFor = (path: string): 0 | -1 => (path === rovingPath ? 0 : -1)
  const activeLayoutIndex = rovingPath ? (layoutIndexByPath.get(rovingPath) ?? -1) : -1
  const editLayoutIndex = rows.findIndex((row) => row.kind === 'edit')
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      // A focused row must remain the one Tab stop, and unmounting an offscreen
      // TreeInput would blur/cancel it. Pin at most those two exceptional rows.
      for (const index of [activeLayoutIndex, editLayoutIndex]) {
        if (index >= 0 && !indexes.includes(index)) indexes.push(index)
      }
      return indexes.sort((a, b) => a - b)
    },
    [activeLayoutIndex, editLayoutIndex],
  )

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => 24,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
    rangeExtractor,
    enabled: !contentMode,
  })

  const pendingFocusRef = useRef<string | null>(null)
  const focusPath = useCallback(
    (path: string) => {
      const index = layoutIndexByPath.get(path)
      if (index === undefined) return
      pendingFocusRef.current = path
      setRememberedRovingPath(path)
      virtualizer.scrollToIndex(index, { align: 'auto' })
    },
    [layoutIndexByPath, virtualizer],
  )

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending || pending !== rovingPath || !scrollEl) return
    // `scrollToIndex` may have to widen the virtual range before the row exists in
    // the DOM, and that lands a frame later — without the retry a jump to a far-off
    // row (End, PageDown, a typeahead match) scrolled but left focus behind, so the
    // NEXT arrow key navigated from the old row.
    let frame = 0
    const tryFocus = () => {
      const path = pendingFocusRef.current
      if (!path) return
      const target = scrollEl.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)
      if (!target) {
        frame = requestAnimationFrame(tryFocus)
        return
      }
      pendingFocusRef.current = null
      target.focus({ preventScroll: true })
    }
    tryFocus()
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [rovingPath, rows, scrollEl])

  // Reveal emits a semantic path only after its ancestor loads/expands settle.
  // Mapping it to a layout index works even when the target had no DOM node.
  // `revealScrollIndex` owns the once-per-intent rule — see the note there for why
  // re-serving a completed request is what made the tree jump on every expand.
  const revealedIntentRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const index = revealScrollIndex(revealRequest, revealedIntentRef.current, (path) =>
      layoutIndexByPath.get(path),
    )
    if (index === null) {
      if (!revealRequest) revealedIntentRef.current = null
      return
    }
    revealedIntentRef.current = revealRequest?.intent ?? null
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [layoutIndexByPath, revealRequest, virtualizer])

  const [typeahead] = useState(() => createTypeahead())
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const target = e.target
    if (!(target instanceof Element)) return
    const currentPath = target.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath
    if (!currentPath) return // inline create/rename input owns its own keys
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      const navigation = fileTreeNavigation(entryRows, currentPath, e.key as FileTreeNavigationKey)
      if (!navigation) return
      e.preventDefault()
      if (navigation.kind === 'toggle') doToggleDir(navigation.path)
      else focusPath(navigation.path)
      return
    }
    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
    const match = typeahead.handleChar(e.key, entryRows, currentPath)
    if (!match) return
    e.preventDefault()
    focusPath(match)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Files"
        actions={
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
                  disabled={!root || !clipboard}
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
                  disabled={expanded.size === 0}
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
                    {refreshing ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
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
        }
      />
      {searchVisible && (
        <WorkbenchToolbar
          ref={searchRowRef}
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
            placeholder={searchMode === 'names' ? 'Filter files by name' : 'Search in files'}
            aria-label={searchMode === 'names' ? 'Filter files by name' : 'Search in files'}
            className="min-w-0 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                closeSearch()
              }
            }}
          />
          <WorkbenchToolbarSection spacing="compact" aria-label="Search mode">
            <ModeToggle
              active={searchMode === 'content'}
              onClick={() => setSearchMode('content')}
              title="Search in file contents"
            >
              <Text className="size-3" />
            </ModeToggle>
            <ModeToggle
              active={searchMode === 'names'}
              onClick={() => setSearchMode('names')}
              title="Filter files by name"
            >
              <Filter className="size-3" />
            </ModeToggle>
          </WorkbenchToolbarSection>
        </WorkbenchToolbar>
      )}
      {contentMode ? (
        <ContentSearchView cs={content} query={query} />
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={setScrollEl}
              onClick={(e) => {
                if (e.target === e.currentTarget) clearSelection()
              }}
              onKeyDown={onTreeKeyDown}
              onFocus={(event) => {
                const target = event.target
                if (!(target instanceof Element)) return
                const path = target.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath
                if (path) setRememberedRovingPath(path)
              }}
              {...dnd.rootDropTarget(root)}
              role="tree"
              aria-label="Files"
              aria-multiselectable
              className={cn(
                'min-h-0 flex-1 overflow-auto scrollbar-thin virtual-scroller py-1',
                DROP_TARGET_TRANSITION,
                dnd.isRootOver && DROP_TARGET_INSET_ACTIVE,
              )}
            >
              {!sessionId ? (
                <EmptyHint className="pointer-events-none px-3 text-xs">
                  No active session.
                </EmptyHint>
              ) : problem ? (
                <ProblemLine {...problem} className="px-3 py-1" />
              ) : root ? (
                filter && filter.matchCount === 0 ? (
                  <EmptyHint className="pointer-events-none px-3 text-xs">
                    No matching files.
                  </EmptyHint>
                ) : rootIsEmpty ? (
                  <EmptyHint className="pointer-events-none px-3 text-xs">Empty folder</EmptyHint>
                ) : (
                  <FileTreeEntries
                    rows={rows}
                    entryOrder={entryOrder}
                    virtualizer={virtualizer}
                    sessionId={sessionId}
                    activeFilePath={activeFilePath}
                    editError={editError}
                    filterQuery={filterQuery}
                    selected={selected}
                    clipboard={clipboard}
                    decorations={decorations}
                    compareSelectedPath={compareSelectedPath}
                    isSessionCurrent={isSessionCurrent}
                    dnd={dnd}
                    matchesKey={matchesKey}
                    rowOps={rowOps}
                    tabIndexFor={tabIndexFor}
                    selectRow={selectRow}
                    doToggleDir={doToggleDir}
                    expandCompactAt={expandCompactAt}
                    startCreate={startCreate}
                    submitEdit={submitEdit}
                    cancelEdit={cancelEdit}
                  />
                )
              ) : (
                <LoadingHint className="pointer-events-none px-3 text-xs" />
              )}
            </div>
          </ContextMenuTrigger>
          {/* The BACKGROUND menu — without it the blank
              area below the last row is the one place in the tree where right-click does
              nothing (the desktop shell suppresses the browser's own menu). Everything here
              acts on the project root, which is what "nothing in particular is selected"
              means in a tree. */}
          <ContextMenuContent>
            <MenuEntries entries={rootMenu} family="context" />
          </ContextMenuContent>
        </ContextMenu>
      )}
      <ConfirmDialog
        open={pendingDelete !== null && pendingDelete.length > 0}
        title={deleteConfirm.title ?? ''}
        description={deleteConfirm.description}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
