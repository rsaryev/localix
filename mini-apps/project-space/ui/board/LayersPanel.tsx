import { useMemo } from 'react'
import { Group, Lock, LockOpen, X } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { POPOVER_SURFACE } from '@localixai/kit/popover-surface'
import { WorkbenchListRow, WorkbenchListRowTrigger } from '@localixai/kit/workbench-list-row'
import type { SpaceDocument } from '../../shared/format/document'
import { elementName, elementText } from '../../shared/graph/names'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { viewOf } from '../elements'
import { layerRows } from './layers'

/**
 * The layers panel: every element as a row, in the tree of frames and top first. On a large
 * board it is how a person finds a thing, sees what covers what, and reaches what the board
 * itself will not hand them — a LOCKED element lets the pointer through on the board, so here is
 * where it is selected and unlocked. A click (or Enter) selects the row's element alone — a focus
 * the board's camera goes to — and Shift/⌘-click adds it to the selection.
 */
const EXCERPT = 48
const INDENT_PX = 14

export function LayersPanel({
  space,
  selected,
  select,
  commit,
  onClose,
}: {
  space: SpaceDocument
  selected: ReadonlySet<string>
  select: (ids: Iterable<string>, add?: boolean) => void
  commit: (ops: readonly SpaceOp[]) => void
  onClose: () => void
}) {
  const rows = useMemo(() => layerRows(space, spaceTypes), [space])
  return (
    <aside
      aria-label="Layers"
      className={cn(
        POPOVER_SURFACE,
        'nodrag nowheel absolute bottom-14 right-3 top-3 z-(--z-controls) flex w-64 max-w-[calc(100%-5rem)] flex-col overflow-hidden',
      )}
    >
      <PanelHeader
        title="Layers"
        tone="content"
        summary={<span className="text-2xs tabular-nums text-text-faint">{rows.length}</span>}
        actions={
          <IconButton size="sm" aria-label="Close layers" tooltip="Close layers" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        }
      />
      <ul
        aria-label="Board elements"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
      >
        {rows.length === 0 && (
          <li className="px-3 py-2 text-2xs text-text-faint">The board is empty.</li>
        )}
        {rows.map((row) => {
          const view = viewOf(row.element.type)
          const text = elementText(space, spaceTypes, row.id).replace(/\s+/gu, ' ').trim()
          const label = elementName(space, spaceTypes, row.id, EXCERPT)
          const Icon = view?.Icon
          const on = selected.has(row.id)
          return (
            <li key={row.id}>
              <WorkbenchListRow density="dense" active={on}>
                <WorkbenchListRowTrigger
                  aria-pressed={on}
                  style={{ paddingLeft: 6 + row.depth * INDENT_PX }}
                  onClick={(event) => select([row.id], event.shiftKey || event.metaKey)}
                  title={text || undefined}
                >
                  {Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-text-faint" />}
                  <span
                    className={cn('min-w-0 flex-1 truncate', row.container && 'font-medium')}
                    style={
                      row.element.opacity !== undefined
                        ? { opacity: Math.max(0.45, row.element.opacity) }
                        : undefined
                    }
                  >
                    {label}
                  </span>
                </WorkbenchListRowTrigger>
                {row.group && (
                  <Group
                    aria-label={`In group ${row.group}`}
                    className="size-3 shrink-0 text-text-faint"
                  />
                )}
                <IconButton
                  size="xs"
                  aria-label={row.element.locked ? 'Unlock' : 'Lock'}
                  tooltip={row.element.locked ? 'Unlock element' : 'Lock element'}
                  className={cn(
                    !row.element.locked &&
                      'opacity-0 group-hover/workbench-row:opacity-100 group-focus-within/workbench-row:opacity-100',
                  )}
                  onClick={() => {
                    commit([{ op: 'update', id: row.id, locked: !row.element.locked }])
                  }}
                >
                  {row.element.locked ? (
                    <Lock className="size-3" />
                  ) : (
                    <LockOpen className="size-3" />
                  )}
                </IconButton>
              </WorkbenchListRow>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
