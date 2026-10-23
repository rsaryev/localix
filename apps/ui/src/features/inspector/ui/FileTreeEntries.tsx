import { useEffect, useRef, useState } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { fileIcon, folderIcon } from '@/shared/ui/file-icon/fileIcon'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@localixai/kit/context-menu'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { indentGuideStyle } from '@localixai/kit/tree-navigation'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import {
  useCompareSelection,
  compareTwoFiles,
  compareFileWithClipboard,
} from '../model/compareSelection'
import type { SelectMods, TreeClipboard } from './useFileTree'
import type { FileTreeDecorationIndex } from '@localixai/mini-app-sdk/ui'
import type { useTreeDnd } from './useTreeDnd'
import { treeRowKeyDown, type TreeRowOps, type TreeRowTarget } from './treeRowOps'
import { TreeRowOpsItems } from './TreeRowOpsItems'
import { isPrimaryModifier, type useKeybindingMatcher } from '@/shared/lib/keybindings'
import { toast } from '@/shared/lib/notify'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { DROP_TARGET_INSET_ACTIVE } from '@localixai/kit/drop-target'
import { loadFileEditor } from '../model/fileEditorLoader'
import type { FileTreeEntryRow, FileTreeRow } from './fileTreeRows'
import type { VisibleRow } from './fileTreePaths'
import { Input } from '@localixai/kit/input'

/** Render an entry name with the filename-filter match highlighted (case-insensitive). */
function highlightName(name: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return name
  const i = name.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return name
  return (
    <>
      {name.slice(0, i)}
      <mark className="rounded-xs bg-foreground/15 px-px font-medium text-foreground">
        {name.slice(i, i + q.length)}
      </mark>
      {name.slice(i + q.length)}
    </>
  )
}

/** Inline create/rename field rendered in place of a normal tree row. */
function TreeInput({
  kind,
  initial,
  pad,
  error,
  onSubmit,
  onCancel,
}: {
  kind: 'file' | 'dir'
  initial: string
  pad: number
  error: string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initial])
  const { Icon, color } = kind === 'dir' ? folderIcon(false) : fileIcon(initial || 'x')
  return (
    <div>
      <div style={{ paddingLeft: pad }} className="flex h-6 items-center gap-1.5 pr-2">
        <Icon className={`size-4 shrink-0 ${color}`} />
        <Input
          ref={ref}
          aria-label={`${kind === 'dir' ? 'Folder' : 'File'} name`}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (value.trim()) onSubmit(value.trim())
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
          onBlur={onCancel}
          // No fill override: Input already carries the `--input` veil, and `bg-surface-raised`
          // mixes from a darker ground than the tree, so the rename field read as a black slot.
          className="h-5 min-w-0 flex-1 rounded-sm border-control-border-focus px-1 py-0 text-xs"
        />
      </div>
      {error && (
        <div
          role="alert"
          style={{ paddingLeft: pad + 22 }}
          className="pb-1 text-xs text-status-error"
        >
          {error}
        </div>
      )}
    </div>
  )
}

interface FileTreeEntriesProps {
  rows: readonly FileTreeRow[]
  entryOrder: readonly VisibleRow[]
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  sessionId: string | null
  activeFilePath: string | null
  editError: string | null
  filterQuery: string
  selected: ReadonlyMap<string, 'file' | 'dir'>
  clipboard: TreeClipboard | null
  decorations: FileTreeDecorationIndex
  compareSelectedPath: string | null
  isSessionCurrent: () => boolean
  dnd: ReturnType<typeof useTreeDnd>
  matchesKey: ReturnType<typeof useKeybindingMatcher>
  rowOps: TreeRowOps
  tabIndexFor: (path: string) => number
  selectRow: (row: VisibleRow, mods: SelectMods, orderedRows: readonly VisibleRow[]) => void
  doToggleDir: (path: string) => void
  expandCompactAt: (path: string) => void
  startCreate: (parentPath: string, kind: 'file' | 'dir') => void | Promise<unknown>
  submitEdit: (value: string) => void | Promise<unknown>
  cancelEdit: () => void
}

function EntryRow({ row, props }: { row: FileTreeEntryRow; props: FileTreeEntriesProps }) {
  const pad = row.depth * 12 + 8

  if (row.type === 'dir') {
    const isCompact = row.compactChain.length > 1
    const { Icon, color } = folderIcon(row.isOpen)
    const dirTarget: TreeRowTarget = {
      row,
      entry: row.entry,
      parentPath: row.parentPath,
      pasteTarget: row.path,
    }
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            data-tree-path={row.path}
            data-tree-name={row.name}
            draggable
            onDragStart={(event) => props.dnd.beginDrag(event, row.path, `${row.path}/`)}
            onDragEnd={props.dnd.endDrag}
            {...props.dnd.dropTarget(row.path, row.path)}
            onClick={(event) => {
              const mods = {
                toggle: isPrimaryModifier(event),
                range: event.shiftKey,
              }
              props.selectRow(row, mods, props.entryOrder)
              if (mods.toggle || mods.range) return
              const segment = isCompact
                ? (event.target as HTMLElement).closest?.('[data-seg]')?.getAttribute('data-seg')
                : null
              if (segment && segment !== row.path) props.expandCompactAt(segment)
              else props.doToggleDir(row.path)
            }}
            onContextMenu={(event) => {
              // The tree's BACKGROUND menu wraps the scroller, so a row's right-click has to
              // stop here or both menus open on one press. Radix composes its own trigger
              // handler onto this same element after ours, so the row menu still opens.
              event.stopPropagation()
              if (!props.selected.has(row.path)) props.selectRow(row, {}, props.entryOrder)
            }}
            onKeyDown={(event) => treeRowKeyDown(event, props.matchesKey, props.rowOps, dirTarget)}
            title={row.path}
            role="treeitem"
            tabIndex={props.tabIndexFor(row.path)}
            aria-level={row.depth + 1}
            aria-posinset={row.ariaPosInSet}
            aria-setsize={row.ariaSetSize}
            aria-expanded={row.isOpen}
            aria-selected={props.selected.has(row.path)}
            style={{ paddingLeft: pad, ...indentGuideStyle(row.depth) }}
            className={cn(
              'flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs text-foreground transition-colors hover:bg-surface-hover outline-none focus-ring',
              props.selected.has(row.path) && 'bg-surface-active',
              props.clipboard?.mode === 'cut' &&
                props.clipboard.paths.includes(row.path) &&
                'opacity-50',
              props.dnd.dragOverKey === row.path && DROP_TARGET_INSET_ACTIVE,
            )}
          >
            <ChevronRight
              className={`size-3.5 shrink-0 text-text-faint transition-transform ${row.isOpen ? 'rotate-90' : ''}`}
            />
            <Icon className={`size-4 shrink-0 ${color}`} />
            {isCompact ? (
              <span className="flex min-w-0 items-center truncate">
                {row.compactChain.map((segmentPath, index) => (
                  <span key={segmentPath} className="flex min-w-0 items-center">
                    {index > 0 && (
                      <span aria-hidden className="mx-0.5 shrink-0 text-text-faint/60">
                        /
                      </span>
                    )}
                    <span
                      data-seg={segmentPath}
                      className="truncate rounded-sm px-0.5 hover:bg-surface-hover hover:text-foreground"
                    >
                      {segmentPath.slice(segmentPath.lastIndexOf('/') + 1)}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="min-w-0 truncate">
                {row.filtering ? highlightName(row.name, props.filterQuery) : row.name}
              </span>
            )}
            {!row.isOpen && props.decorations.directoryHasDecorations(row.compactChain[0]!) && (
              <span
                aria-hidden
                title="Contains decorated entries"
                className="ml-auto size-1.5 shrink-0 rounded-full bg-status-warning/80"
              />
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => void props.startCreate(row.path, 'file')}>
            New file…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void props.startCreate(row.path, 'dir')}>
            New folder…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <TreeRowOpsItems ops={props.rowOps} target={dirTarget} isDir />
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const { Icon, color } = fileIcon(row.name)
  const isActive = row.path === props.activeFilePath
  const changeMeta = props.decorations.decorationFor(row.path)
  const fileTarget: TreeRowTarget = {
    row,
    entry: row.entry,
    parentPath: row.parentPath,
    pasteTarget: row.parentPath,
  }
  // The tree lists ONE chat's workspace, so its rows open into that chat; a tree with no session
  // has no workspace to open from.
  const openRow = (options?: { replace?: boolean; ephemeral?: boolean }) => {
    if (props.sessionId) openFileInGrid({ sessionId: props.sessionId, path: row.path, ...options })
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          data-tree-path={row.path}
          data-tree-name={row.name}
          draggable
          onDragStart={(event) => props.dnd.beginDrag(event, row.path, row.path)}
          onDragEnd={props.dnd.endDrag}
          {...props.dnd.dropTarget(row.path, row.parentPath)}
          onPointerEnter={() => void loadFileEditor()}
          onFocus={() => void loadFileEditor()}
          onClick={(event) => {
            const mods = {
              toggle: isPrimaryModifier(event),
              range: event.shiftKey,
            }
            props.selectRow(row, mods, props.entryOrder)
            if (!mods.toggle && !mods.range) openRow({ replace: true })
          }}
          onDoubleClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) return
            openRow({ ephemeral: false })
          }}
          onContextMenu={(event) => {
            // See the folder row: the background menu is an ancestor trigger.
            event.stopPropagation()
            if (!props.selected.has(row.path)) props.selectRow(row, {}, props.entryOrder)
          }}
          onKeyDown={(event) => treeRowKeyDown(event, props.matchesKey, props.rowOps, fileTarget)}
          title={row.name}
          role="treeitem"
          tabIndex={props.tabIndexFor(row.path)}
          aria-level={row.depth + 1}
          aria-posinset={row.ariaPosInSet}
          aria-setsize={row.ariaSetSize}
          aria-current={isActive ? 'true' : undefined}
          aria-selected={props.selected.has(row.path)}
          style={{ paddingLeft: pad + 16, ...indentGuideStyle(row.depth) }}
          className={cn(
            'flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs transition-colors outline-none focus-ring',
            isActive || props.selected.has(row.path)
              ? 'bg-surface-active font-medium text-foreground'
              : 'text-text-soft hover:bg-surface-hover hover:text-foreground',
            props.clipboard?.mode === 'cut' &&
              props.clipboard.paths.includes(row.path) &&
              'opacity-50',
            props.dnd.dragOverKey === row.path && DROP_TARGET_INSET_ACTIVE,
          )}
        >
          <Icon className={`size-4 shrink-0 ${color}`} />
          <span className={cn('truncate', changeMeta && 'text-foreground')}>
            {row.filtering ? highlightName(row.name, props.filterQuery) : row.name}
          </span>
          {changeMeta && (
            <span
              title={changeMeta.label}
              className={cn('ml-auto shrink-0 font-mono text-2xs font-semibold', changeMeta.color)}
            >
              {changeMeta.letter}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openRow()}>Open</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            if (props.sessionId)
              useCompareSelection.getState().selectForCompare(props.sessionId, row.path)
          }}
        >
          Select for compare
        </ContextMenuItem>
        {props.compareSelectedPath && props.compareSelectedPath !== row.path && (
          <ContextMenuItem
            onSelect={() =>
              void compareTwoFiles(
                props.sessionId,
                props.compareSelectedPath!,
                row.path,
                props.isSessionCurrent,
              )
            }
          >
            Compare with &lsquo;{baseName(props.compareSelectedPath)}&rsquo;
          </ContextMenuItem>
        )}
        {props.selected.has(row.path) && props.selected.size === 2 && (
          <ContextMenuItem
            onSelect={() => {
              const [a, b] = [...props.selected.keys()]
              void compareTwoFiles(props.sessionId, a, b, props.isSessionCurrent)
            }}
          >
            Compare selected
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() =>
            void compareFileWithClipboard(props.sessionId, row.path, props.isSessionCurrent)
          }
        >
          Compare with clipboard
        </ContextMenuItem>
        <ContextMenuSeparator />
        <TreeRowOpsItems ops={props.rowOps} target={fileTarget} isDir={false} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function StatusRow({ row }: { row: Extract<FileTreeRow, { kind: 'status' }> }) {
  if (row.status === 'loading') {
    return (
      <div
        style={{ paddingLeft: row.depth * 12 + 18 }}
        className="flex h-6 items-center text-xs text-text-faint"
      >
        <ActivitySignal label="Loading" className="[&_svg]:size-2.5" labelClassName="min-w-0" />
      </div>
    )
  }
  if (row.status === 'empty') {
    return (
      <div
        style={{ paddingLeft: row.depth ? row.depth * 12 + 30 : undefined }}
        className={cn(
          'pointer-events-none flex h-6 select-none items-center pr-2 text-xs text-text-faint',
          row.depth === 0 && 'justify-center px-3 text-center',
        )}
      >
        Empty folder
      </div>
    )
  }
  const count = row.count ?? 0
  return (
    <div
      style={{ paddingLeft: row.depth * 12 + 30 }}
      role="button"
      tabIndex={-1}
      title="This folder has too many items to list — showing the first 1000"
      onClick={() =>
        toast.info(`${count.toLocaleString()} more item${count === 1 ? '' : 's'} not shown`, {
          description:
            'Large folders are capped at 1000 entries to keep the tree responsive. Search the workspace to reach the rest.',
        })
      }
      className="flex h-6 cursor-default select-none items-center pr-2 text-xs italic text-text-faint transition-colors hover:text-text-soft"
    >
      … {count.toLocaleString()} more item{count === 1 ? '' : 's'}
    </div>
  )
}

/**
 * Render only the virtualizer's bounded window over the authoritative flat row model.
 * Active/edit rows can be outside that window but are pinned by the sidebar's range
 * extractor, preserving roving focus and inline input while the viewport scrolls.
 */
export function FileTreeEntries(props: FileTreeEntriesProps): React.ReactNode {
  return (
    <div
      className="pointer-events-none relative w-full"
      style={{ height: props.virtualizer.getTotalSize() }}
    >
      {props.virtualizer.getVirtualItems().map((item) => {
        const row = props.rows[item.index]
        if (!row) return null
        return (
          <div
            key={row.key}
            ref={props.virtualizer.measureElement}
            data-index={item.index}
            role="none"
            className="pointer-events-auto absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {row.kind === 'entry' ? (
              <EntryRow row={row} props={props} />
            ) : row.kind === 'edit' ? (
              <TreeInput
                kind={row.edit.kind}
                initial={row.edit.mode === 'rename' ? row.edit.name : ''}
                pad={row.depth * 12 + 8 + (row.edit.kind === 'file' ? 16 : 0)}
                error={props.editError}
                onSubmit={(value) => void props.submitEdit(value)}
                onCancel={props.cancelEdit}
              />
            ) : (
              <StatusRow row={row} />
            )}
          </div>
        )
      })}
    </div>
  )
}
