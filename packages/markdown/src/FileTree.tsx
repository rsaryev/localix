import { useMemo, useState, type ComponentType } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  indentGuideStyle,
  treeNavKeyDown,
  useTreeRovingFocus,
} from '@localixai/kit/tree-navigation'
import { File, Folder, FolderOpen } from 'lucide-react'
import { parseFileTree, type TreeRow } from '@localixai/markdown/fileTreeParse'

/**
 * A ```tree fence (`@localixai/markdown/dialect`): a directory layout drawn the way the Files
 * sidebar draws one — the same coloured file-type glyphs, open/closed folder glyphs, indent
 * guides, 12px step and row metrics — instead of box characters in monospace. A folder folds and
 * unfolds on click, and the tree is one Tab stop walked with the arrow keys (the kit's tree
 * navigation), so a long layout can be read one branch at a time.
 *
 * Not the sidebar's row component itself: that row is a file-system row — selection, drag and
 * drop, rename, a context menu — and none of it means anything for a drawing in a reply.
 */
type TreeIcon = { Icon: ComponentType<{ className?: string }>; color: string }

const defaultTreeIcon = (row: TreeRow, open: boolean): TreeIcon => ({
  Icon: row.folder ? (open ? FolderOpen : Folder) : File,
  color: 'text-text-soft',
})

export function FileTree({
  source,
  getIcon = defaultTreeIcon,
}: {
  source: string
  getIcon?: (row: TreeRow, open: boolean) => TreeIcon
}) {
  const rows = useMemo(() => parseFileTree(source), [source])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const { attachContainer, onFocus, tabIndexFor } = useTreeRovingFocus()
  if (rows.length === 0) return null

  const isHidden = (row: TreeRow): boolean => {
    for (let parent = row.parent; parent !== null; parent = rows[parent]!.parent)
      if (collapsed.has(rows[parent]!.path)) return true
    return false
  }
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const parentOf = (path: string) => {
    const row = rows.find((candidate) => candidate.path === path)
    return row?.parent == null ? null : rows[row.parent]!.path
  }

  return (
    <div
      ref={attachContainer}
      role="tree"
      aria-label="File tree"
      className="lx-tree nodrag"
      // Focusable only from script: the Tab stop is the roving row, not the frame.
      tabIndex={-1}
      onFocus={onFocus}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Navigation needs ALL visible rows, not the focused row's empty descendants. Delegate
        // from the tree, and keep handled keys from also nudging its element on a board.
        treeNavKeyDown(event, { toggleDir: toggle, parentOf })
        if (event.defaultPrevented) event.stopPropagation()
      }}
    >
      {rows.map((row) => {
        if (isHidden(row)) return null
        const open = !collapsed.has(row.path)
        const { Icon, color } = getIcon(row, open)
        return (
          <div
            key={row.path}
            role="treeitem"
            data-tree-path={row.path}
            tabIndex={tabIndexFor(row.path)}
            aria-level={row.depth + 1}
            aria-selected={false}
            {...(row.folder ? { 'aria-expanded': open } : {})}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true })
              if (row.folder) toggle(row.path)
            }}
            onKeyDown={(event) => {
              // Even a leaf owns activation: Enter must not edit its board element, nor
              // Space arm the board's pan gesture. Folder activation mirrors its click.
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              if (row.folder) toggle(row.path)
            }}
            // The sidebar's metrics: 12px per level, a chevron column before every folder.
            style={{
              paddingLeft: row.depth * 12 + (row.folder ? 8 : 24),
              ...indentGuideStyle(row.depth),
            }}
            className={cn(
              'lx-tree-row flex h-6 items-center gap-1.5 rounded-sm pr-2 text-xs outline-none focus-ring',
              row.folder
                ? 'cursor-pointer text-foreground hover:bg-surface-hover'
                : 'text-text-soft',
            )}
          >
            {row.folder && (
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 text-text-faint transition-transform duration-(--dur-fast) motion-reduce:transition-none',
                  open && 'rotate-90',
                )}
              />
            )}
            <Icon aria-hidden className={cn('size-4 shrink-0', color)} />
            <span className="min-w-0 truncate" title={row.name}>
              {row.name.replace(/\/$/, '')}
            </span>
            {row.comment && (
              <span
                className="lx-tree-comment ml-2 min-w-0 truncate text-text-faint"
                title={row.comment}
              >
                {row.comment}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
