import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'
import { toggleInSet } from '@localixai/mini-app-sdk/ui/utilities'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import type { ChangeActions } from '../../model/changeActions'
import { scopeChangeActions } from './scopeChangeActions'
import { useChangesScrollRoot, useOffsetWithin } from './ChangesScrollArea'
import { ChangesRowMenu, rowHasMenu } from './ChangesRowMenu'
import { DirRow, FileRow, type ChangeGroup } from './ChangesTreeRow'
import {
  buildChangesTree,
  changesTreeNavigation,
  createPrefixBuffer,
  flattenChangesTree,
  isTreeNavKey,
  typeaheadMatch,
  type ChangesTreeRow,
} from './changesTreeRows'

export type { ChangeGroup } from './ChangesTreeRow'

/** The dense row tier (`WorkbenchListRow density="dense"`); rows are measured, this seeds the layout. */
const ROW_ESTIMATE = 28

const pathOf = (target: EventTarget | null): string | undefined =>
  target instanceof Element
    ? target.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath
    : undefined

/**
 * Folder tree of working-tree changes, built from the flat change list, rendering
 * ONLY the rows near the viewport.
 *
 * It used to mount every row, each with its own Radix context menu: 5,000
 * changed files meant 5,000 menu roots and tens of thousands of DOM nodes, and
 * the panel froze on every poll that touched the list. Now the visible rows are
 * one flat model (`changesTreeRows`), a virtualizer mounts a window of them
 * against the panel's shared scroll area, and ONE context menu on the tree
 * resolves the right-clicked row from its `data-row-index`. Keyboard navigation
 * and typeahead read the model, not the DOM, so rows off screen stay reachable;
 * the roving Tab stop is pinned into the window so focus never unmounts.
 */
export const ChangesTree = memo(function ChangesTree({
  files,
  group,
  selectedPath,
  actions,
  onOpen,
}: {
  files: RepoFileChange[]
  group: ChangeGroup
  selectedPath: string | null
  actions: ChangeActions
  onOpen: (file: RepoFileChange, staged: boolean) => void
}) {
  const tree = useMemo(() => buildChangesTree(files), [files])
  const scopedActions = useMemo(() => scopeChangeActions(actions, files), [actions, files])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((path: string) => setCollapsed((s) => toggleInSet(s, path)), [])
  const rows = useMemo(() => flattenChangesTree(tree, collapsed), [tree, collapsed])
  const indexByPath = useMemo(() => new Map(rows.map((row, i) => [row.path, i])), [rows])

  // One Tab stop, validated against the MODEL (a remembered row that vanished falls back to the
  // first), and pinned into the rendered range so the focused row is never unmounted.
  const [remembered, setRemembered] = useState<string | null>(null)
  const rovingPath =
    remembered && indexByPath.has(remembered) ? remembered : (rows[0]?.path ?? null)
  const rovingIndex = rovingPath ? (indexByPath.get(rovingPath) ?? -1) : -1
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (rovingIndex >= 0 && !indexes.includes(rovingIndex)) indexes.push(rovingIndex)
      return indexes.sort((a, b) => a - b)
    },
    [rovingIndex],
  )

  const scrollRoot = useChangesScrollRoot()
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
  const scrollMargin = useOffsetWithin(scrollRoot, listEl)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRoot,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    scrollMargin,
    getItemKey: (index) => rows[index]?.path ?? index,
    rangeExtractor,
  })

  // Focus a row that may not be mounted yet: remember it (which pins it into the range), scroll
  // to it, then focus once it exists — a far jump (End, typeahead) widens the range a frame later.
  const pendingFocus = useRef<string | null>(null)
  const focusPath = (path: string) => {
    const index = indexByPath.get(path)
    if (index === undefined) return
    pendingFocus.current = path
    setRemembered(path)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending || pending !== rovingPath || !listEl) return
    let frame = 0
    const tryFocus = () => {
      const path = pendingFocus.current
      if (!path) return
      const target = listEl.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)
      if (!target) {
        frame = requestAnimationFrame(tryFocus)
        return
      }
      pendingFocus.current = null
      target.focus({ preventScroll: true })
    }
    tryFocus()
    return () => cancelAnimationFrame(frame)
  }, [rovingPath, rows, listEl])

  const [prefixOf] = useState(() => createPrefixBuffer())
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const current = pathOf(e.target)
    const index = current === undefined ? undefined : indexByPath.get(current)
    if (index === undefined) return
    if (isTreeNavKey(e.key)) {
      const move = changesTreeNavigation(rows, index, e.key)
      if (!move) return
      e.preventDefault()
      if (move.kind === 'toggle') toggle(move.path)
      else focusPath(move.path)
      return
    }
    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
    const match = typeaheadMatch(rows, index, prefixOf(e.key))
    if (!match) return
    e.preventDefault()
    focusPath(match)
  }

  // The single delegated menu: resolve the row under the pointer before Radix opens. A row with
  // nothing to offer (a Merge folder) or the gap between rows cancels the open.
  const [menuRow, setMenuRow] = useState<ChangesTreeRow | null>(null)
  const onContextMenu = (e: React.MouseEvent) => {
    const cell = (e.target as Element).closest<HTMLElement>('[data-row-index]')
    const row = cell ? rows[Number(cell.dataset.rowIndex)] : undefined
    if (!row || !rowHasMenu(row, group)) {
      e.preventDefault()
      return
    }
    setMenuRow(row)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        <div
          role="tree"
          aria-label={
            group === 'conflict'
              ? 'Merge changes'
              : group === 'staged'
                ? 'Staged changes'
                : 'Changes'
          }
          className="py-1"
          // The rows hold the roving tab stop; the tree itself only has to be focusable.
          tabIndex={-1}
          onFocus={(e) => {
            const path = pathOf(e.target)
            if (path) setRemembered(path)
          }}
          onKeyDown={onKeyDown}
        >
          <div
            ref={setListEl}
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  data-row-index={item.index}
                  role="none"
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
                >
                  {row.kind === 'dir' ? (
                    <DirRow
                      row={row}
                      group={group}
                      tabbable={row.path === rovingPath}
                      actions={scopedActions}
                      onToggle={toggle}
                    />
                  ) : (
                    <FileRow
                      row={row}
                      group={group}
                      active={row.file.path === selectedPath}
                      tabbable={row.path === rovingPath}
                      actions={scopedActions}
                      onOpen={onOpen}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuRow && <ChangesRowMenu row={menuRow} group={group} actions={scopedActions} />}
      </ContextMenuContent>
    </ContextMenu>
  )
})
