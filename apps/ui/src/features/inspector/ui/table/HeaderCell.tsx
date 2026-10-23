import { createElement, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Filter, KeyRound } from 'lucide-react'
import { isNumericType, type TableColumn } from '@localixai/dataview'
import { columnTypeIcon } from '@/shared/lib/columnTypeIcon'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { CellEditor } from './CellEditor'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { WorkbenchSash } from '@localixai/kit/button'
import { COL_MIN } from './useColumnLayout'
import type { PluginTableGridProps } from '@localixai/mini-app-sdk/ui'
import { ColumnMenu } from './ColumnMenu'

/**
 * One semantic column header: a data-type glyph + optional primary-key glyph,
 * click-to-sort title, a hover filter Popover, and a drag-to-resize edge. The
 * container is not a <button> because it owns several independent controls.
 *
 * The filter falls back from the column-scoped `onColumnFilter` (a server-side
 * `col LIKE %value%` in the DB console) to the equality `onCellFilter` when the
 * consumer wires only the latter — so a grid gets a funnel if it can filter AT ALL.
 */
export function HeaderCell({
  col,
  active,
  dir,
  isPk,
  showColumnTypes,
  onToggleSort,
  onColumnFilter,
  onCellFilter,
  onResizeStart,
  onResizeKeyDown,
  onResetWidth,
  columnIndex,
  columnWidth,
  showColumnIcons = true,
  columnActions,
  columnCount = 0,
}: {
  col: TableColumn
  active: boolean
  dir?: 'asc' | 'desc'
  isPk: boolean
  showColumnTypes?: boolean
  onToggleSort: (columnId: string) => void
  onColumnFilter?: (columnId: string, value: string) => void
  onCellFilter?: (columnId: string, value: unknown) => void
  onResizeStart: (id: string, e: React.MouseEvent) => void
  onResizeKeyDown: (id: string, e: React.KeyboardEvent) => void
  onResetWidth: (id: string) => void
  /** One-based ARIA column index; column 1 is the row-number gutter. */
  columnIndex: number
  /** Fixed user width; undefined means the CSS grid still owns an automatic track. */
  columnWidth?: number
  showColumnIcons?: boolean
  columnActions?: PluginTableGridProps['columnActions']
  columnCount?: number
}) {
  const sortable = col.sortable !== false
  const numeric = isNumericType(col.type)
  const typeIcon = columnTypeIcon(col.type)
  const canFilter = !!(onColumnFilter || onCellFilter)
  const [filtering, setFiltering] = useState(false)
  const [value, setValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeFilter = (restoreFocus = false) => {
    setValue('')
    setFiltering(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }
  const submit = () => {
    const v = value.trim()
    if (v) {
      if (onColumnFilter) onColumnFilter(col.id, v)
      else onCellFilter?.(col.id, v)
    }
    closeFilter(true)
  }
  return (
    <div
      role="columnheader"
      aria-colindex={columnIndex}
      aria-sort={
        sortable ? (active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined
      }
      className={cn(
        'group/hcell relative flex h-7 items-center gap-1 border-r border-border-soft px-2 font-medium text-text-soft last:border-r-0',
        numeric ? 'justify-end text-right' : 'justify-start text-left',
        active && 'text-foreground',
      )}
    >
      {showColumnIcons &&
        createElement(typeIcon, {
          className: 'size-3 shrink-0 text-text-faint',
          'aria-hidden': true,
        })}
      {isPk && <KeyRound className="size-3 shrink-0 text-status-warning" aria-hidden />}
      {renaming ? (
        <CellEditor
          initial={col.title}
          label={`${col.title} column name`}
          allowNull={false}
          onCancel={() => setRenaming(false)}
          onCommit={(title) => {
            columnActions?.rename?.(col.id, title ?? '')
            setRenaming(false)
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!sortable && !columnActions?.rename}
          onDoubleClick={(event) => {
            if (columnActions?.rename) {
              event.stopPropagation()
              setRenaming(true)
            }
          }}
          onClick={() => sortable && onToggleSort(col.id)}
          title={`${col.title} · ${col.type}${isPk ? ' · primary key' : ''}`}
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-xs outline-none transition-colors focus-ring',
            sortable && 'cursor-pointer hover:text-foreground',
          )}
        >
          <span className="truncate">{col.title}</span>
          {showColumnTypes && (
            <span className="shrink-0 text-2xs font-normal lowercase text-text-faint">
              {col.type}
            </span>
          )}
          {active &&
            (dir === 'desc' ? (
              <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowUp className="size-3 shrink-0" aria-hidden="true" />
            ))}
        </button>
      )}
      {columnActions && !renaming && (
        <ColumnMenu
          id={col.id}
          title={col.title}
          index={columnIndex - 2}
          count={columnCount}
          actions={columnActions}
          rename={() => setRenaming(true)}
        />
      )}
      {canFilter && (
        <Popover
          open={filtering}
          onOpenChange={(next) => {
            if (next) setFiltering(true)
            else closeFilter()
          }}
        >
          <PopoverTrigger asChild>
            <IconButton
              ref={triggerRef}
              aria-label={`Filter ${col.title} column`}
              tooltip={`Filter ${col.title}`}
              size="xs"
              className={cn(
                'shrink-0 transition-opacity',
                filtering
                  ? 'opacity-100 text-status-info'
                  : 'lx-hover-actions opacity-0 group-hover/hcell:opacity-100 focus-visible:opacity-100',
              )}
            >
              <Filter className="size-3" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align={numeric ? 'end' : 'start'}
            sideOffset={2}
            aria-label={`Filter ${col.title} column`}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              inputRef.current?.focus({ preventScroll: true })
            }}
            className="w-56 gap-0 p-1"
          >
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <Input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeFilter(true)
                  }
                }}
                aria-label={`Filter ${col.title}`}
                placeholder="Contains…"
                spellCheck={false}
                className="min-w-0 flex-1 font-normal"
              />
              <IconButton
                type="submit"
                disabled={value.trim().length === 0}
                aria-label={`Apply ${col.title} filter`}
                tooltip="Apply filter"
                size="xs"
              >
                <Check className="size-3" />
              </IconButton>
            </form>
          </PopoverContent>
        </Popover>
      )}
      {/* Drag the right edge to resize this column. */}
      <WorkbenchSash
        orientation="vertical"
        label={`Resize ${col.title} column`}
        resetLabel="reset column width"
        valueMin={COL_MIN}
        valueMax={
          typeof window === 'undefined'
            ? Math.max(COL_MIN * 8, columnWidth ?? COL_MIN)
            : Math.max(COL_MIN, window.innerWidth, columnWidth ?? COL_MIN)
        }
        valueNow={columnWidth ?? COL_MIN}
        valueText={columnWidth == null ? 'Automatic width' : `${Math.round(columnWidth)} pixels`}
        onMouseDown={(e) => onResizeStart(col.id, e)}
        onKeyDown={(e) => onResizeKeyDown(col.id, e)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onResetWidth(col.id)
        }}
        className="absolute -right-[3px] top-0 z-(--z-controls) h-full"
      />
    </div>
  )
}
