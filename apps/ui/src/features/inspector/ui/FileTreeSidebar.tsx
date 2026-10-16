import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { toast } from '@/shared/lib/notify'
import { PanelHeader } from '@localixai/kit/panel-header'
import { subscribeNewFile } from '@/shared/lib/explorerBus'
import { ContentSearchView } from './search/ContentSearchView'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { useKeybindingMatcher } from '@/shared/lib/keybindings'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { useChatStore } from '@/features/chat/model/store'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useFileTree } from './useFileTree'
import { fileTreeRootMenu } from './fileTreeRootMenu'
import { useFileTreeDecorations, useFileTreeScopeKey } from '@/shared/contrib/fileTreeDecorations'
import { selectedComparePathForSession, useCompareSelection } from '../model/compareSelection'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { ProblemLine } from '@/shared/ui/problem-report'
import { useTreeSearch } from './useTreeSearch'
import { useTreeDnd } from './useTreeDnd'
import type { TreeRowOps } from './treeRowOps'
import { FileTreeEntries } from './FileTreeEntries'
import { FileTreeHeaderActions } from './FileTreeHeaderActions'
import { FileTreeSearchBar } from './FileTreeSearchBar'
import { describeDeletion } from './fileTreeDeletion'
import { useFileTreeFocus } from './useFileTreeFocus'
import { useFileTreeLayout } from './useFileTreeLayout'
import { DROP_TARGET_INSET_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'

const copy = (text: string, label: string) => void copyText(text, label)

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

  const { rows, entryRows, entryOrder, layoutIndexByPath, rootIsEmpty } = useFileTreeLayout({
    root,
    childrenByPath,
    truncatedByPath,
    expanded,
    loading,
    edit,
    filter,
    compactEnabled,
  })

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

  const { onTreeKeyDown } = useFileTreeFocus({
    virtualizer,
    scrollEl,
    rows,
    entryRows,
    layoutIndexByPath,
    rovingPath,
    setRememberedRovingPath,
    revealRequest,
    doToggleDir,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Files"
        actions={
          <FileTreeHeaderActions
            searchVisible={searchVisible}
            openSearch={openSearch}
            closeSearch={closeSearch}
            contentMode={contentMode}
            content={content}
            root={root}
            hasClipboard={Boolean(clipboard)}
            hasExpanded={expanded.size > 0}
            live={live}
            refreshing={refreshing}
            compactEnabled={compactEnabled}
            toggleCompactEnabled={toggleCompactEnabled}
            startCreate={startCreate}
            pasteInto={pasteInto}
            collapseAll={collapseAll}
            loadRoot={loadRoot}
          />
        }
      />
      {searchVisible && (
        <FileTreeSearchBar
          rowRef={searchRowRef}
          mode={searchMode}
          setMode={setSearchMode}
          query={query}
          setQuery={setQuery}
          onClose={closeSearch}
        />
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
