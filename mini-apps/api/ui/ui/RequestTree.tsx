/**
 * The saved requests as a FOLDER TREE — the shape the storage has had since requests moved into
 * the project: a request named `users/list`
 * is a request called `list` in a folder called `users`. The navigator was still drawing a flat
 * list of full names, which is the one view that makes a collection unreadable as it grows.
 *
 * The tree itself is `@localixai/mini-app-sdk/ui/path-tree` — the same builder Source Control's changed-file
 * tree uses, so folders sort first and a single-child chain compacts to `a/b` in both panels.
 * What lives here is only what a REQUEST row needs that a file row does not.
 *
 * Folder state is per collection and remembered, because a person works in one corner of a tree
 * for an hour: collapsing `admin/` should still be collapsed after a send. A newly created real
 * directory starts OPEN, so an empty folder and the first request later saved into it are both
 * visible immediately.
 */

import { useState } from 'react'
import { ChevronRight, FilePlus2, FolderPlus, MoreVertical, Trash2 } from 'lucide-react'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { DROP_TARGET_INSET_ACTIVE } from '@localixai/kit/drop-target'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchListRowTrigger } from '@localixai/kit/workbench-list-row'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { REQUEST_MOVE_MIME, moveTarget, readMovedRequest } from '../model/moveRequest'
import { buildPathTree, type PathTreeNode } from '@localixai/mini-app-sdk/ui/path-tree'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { RequestInfo } from '../../backend/contracts'

const COLLAPSED_KEY = 'api.collapsed-folders'

/** Persisted as the COLLAPSED set, not the open one — see the header on new folders. */
function loadCollapsed(): Set<string> {
  const saved = loadJSON<string[]>(COLLAPSED_KEY)
  return new Set(Array.isArray(saved) ? saved : [])
}

export function RequestTree({
  requests,
  folders,
  renderRow,
  onMove,
  onCreate,
  onCreateFolder,
  onDeleteFolder,
}: {
  requests: RequestInfo[]
  folders: string[]
  /** The caller owns the row — this component owns only the folders around it. */
  renderRow: (request: RequestInfo, displayName?: string) => React.ReactNode
  /** Re-file a request. The folder is part of its name, so a move IS a rename (see moveRequest.ts). */
  onMove: (name: string, to: string) => void
  /** Mint a request directly inside a folder; the caller chooses a collision-free leaf name. */
  onCreate: (folder: string) => void
  onCreateFolder: (parent: string) => void
  onDeleteFolder: (folder: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  // The folder currently under the pointer, so exactly one target lights up. A boolean per row
  // would light every ancestor at once, since dragover bubbles through all of them.
  const [dropFolder, setDropFolder] = useState<string | null>(null)

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      saveJSON(COLLAPSED_KEY, [...next])
      return next
    })
  }

  const nodes = buildPathTree(
    requests.map((request) => ({ path: request.name, value: request })),
    folders,
  )
  const drop = { active: dropFolder, setActive: setDropFolder, onMove }
  return (
    // The tree itself is the ROOT drop target: dragging a request onto the empty space below the
    // rows moves it out of its folder, which is the only gesture that can un-nest one.
    <div
      role="tree"
      aria-label="Saved requests"
      className={cn('min-h-full', dropFolder === '' && DROP_TARGET_INSET_ACTIVE)}
      {...folderDropHandlers('', drop)}
    >
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          renderRow={renderRow}
          drop={drop}
          onCreate={onCreate}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteFolder}
        />
      ))}
    </div>
  )
}

interface DropState {
  active: string | null
  setActive: (folder: string | null) => void
  onMove: (name: string, to: string) => void
}

/**
 * The three handlers a folder row needs, in one place so the root and every folder behave
 * identically. `stopPropagation` on dragover is what keeps the innermost folder the target: the
 * event bubbles through every ancestor, and without it the root would claim every drop.
 */
function folderDropHandlers(folder: string, drop: DropState) {
  return {
    onDragOver: (event: React.DragEvent) => {
      // The payload is unreadable during dragover (browsers protect it), so acceptance is decided
      // by TYPE and the exact target is re-checked on drop, where the name is finally legible.
      if (!event.dataTransfer.types.includes(REQUEST_MOVE_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (drop.active !== folder) drop.setActive(folder)
    },
    onDragLeave: (event: React.DragEvent) => {
      // Only when the pointer left this row for good — a move onto a CHILD element fires leave
      // on the parent too, and clearing there would flicker the highlight on every row crossed.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      if (drop.active === folder) drop.setActive(null)
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      drop.setActive(null)
      const name = readMovedRequest(event.dataTransfer)
      if (!name) return
      const to = moveTarget(name, folder)
      if (to !== null) drop.onMove(name, to)
    },
  }
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  renderRow,
  drop,
  onCreate,
  onCreateFolder,
  onDeleteFolder,
}: {
  node: PathTreeNode<RequestInfo>
  depth: number
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  renderRow: (request: RequestInfo, displayName?: string) => React.ReactNode
  drop: DropState
  onCreate: (folder: string) => void
  onCreateFolder: (parent: string) => void
  onDeleteFolder: (folder: string) => void
}) {
  // Indentation is the ONLY thing depth changes about a leaf: a request in a folder is the same
  // row as one at the root, which is what keeps the method gutter aligned down the whole tree.
  const indent = { paddingLeft: `${depth * 12}px` }

  if (node.type === 'leaf') {
    return (
      <div role="treeitem" aria-level={depth + 1} style={indent}>
        {renderRow(node.value, node.name)}
      </div>
    )
  }

  const isCollapsed = collapsed.has(node.path)
  const count = countLeaves(node)
  const createHere = () => onCreate(node.path)
  const createFolderHere = () => onCreateFolder(node.path)
  // Described once, rendered into the right-click menu and the kebab dropdown alike — the two are
  // the same folder menu reached two ways.
  const actions: MenuEntry[] = [
    { id: 'new-request', label: 'New request here', icon: FilePlus2, onSelect: createHere },
    { id: 'new-folder', label: 'New subfolder', icon: FolderPlus, onSelect: createFolderHere },
    // A folder that still holds requests is not deletable, so the entry is absent rather than
    // present-and-disabled: there is nothing the user could do to enable it from here.
    ...(count === 0
      ? ([
          {
            id: 'delete-folder',
            label: 'Delete folder',
            icon: Trash2,
            danger: true,
            onSelect: () => onDeleteFolder(node.path),
          },
        ] satisfies MenuEntry[])
      : []),
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={!isCollapsed}
          className={cn(drop.active === node.path && DROP_TARGET_INSET_ACTIVE)}
          {...folderDropHandlers(node.path, drop)}
        >
          <div className="group/folder flex min-h-7 items-center hover:bg-surface-hover">
            <WorkbenchListRowTrigger
              type="button"
              onClick={() => onToggle(node.path)}
              style={indent}
              className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs text-text-soft"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-text-faint transition-transform duration-(--dur-fast) motion-reduce:transition-none',
                  !isCollapsed && 'rotate-90',
                )}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
              <span className="shrink-0 text-2xs tabular-nums text-text-faint">{count}</span>
            </WorkbenchListRowTrigger>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="sm"
                  aria-label={`Actions for ${node.path}`}
                  className="mr-1 opacity-0 group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreVertical className="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <MenuEntries entries={actions} family="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!isCollapsed && (
            <div role="group">
              {node.children.map((child) => (
                <TreeRow
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  renderRow={renderRow}
                  drop={drop}
                  onCreate={onCreate}
                  onCreateFolder={onCreateFolder}
                  onDeleteFolder={onDeleteFolder}
                />
              ))}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={actions} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Requests under a folder, at any depth — the count a collapsed row must still report. */
function countLeaves(node: PathTreeNode<RequestInfo>): number {
  if (node.type === 'leaf') return 1
  return node.children.reduce((total, child) => total + countLeaves(child), 0)
}
