/**
 * The windowed schema tree: one scroller, only the rows in view mounted, one Tab stop, and ONE
 * context menu for every row.
 *
 * What it replaces mounted a component and a Radix context menu per row, so 5,000 tables cost
 * 5,000 nodes and 5,000 menus up front, and every row plus its chevron was its own tab stop. The
 * shape is the host Files tree's (`FileTreeSidebar`): a flat row model, TanStack Virtual with the
 * focused row pinned into the window, roving focus resolved from the model, not the DOM.
 */
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  defaultRangeExtractor,
  measureElement,
  observeElementRect,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { isBranch, isTreeItem, type SchemaTreeRow } from '../../model/schemaTreeRows'
import { isSchemaTreeNavKey, schemaTreeNavigation } from '../../model/schemaTreeNavigation'
import type { SchemaTreeActions } from './actions'
import { ConnectionRowView } from './ConnectionRow'
import {
  ColumnRowView,
  GroupRowView,
  IndexRowView,
  SchemaRowView,
  TableRowView,
} from './ObjectRows'
import { IndexLabelRowView, StatusRowView } from './TreeItem'

const ROW_HEIGHT = 24
/**
 * The height assumed while the scroller measures zero. A pane that is not laid out yet (a tab
 * mounting hidden, a split still settling) reports 0, and a zero viewport makes the virtualizer
 * render NO rows — the tree painted empty until the first resize event, and a test DOM with no
 * layout never saw a row at all. One screen of rows is rendered regardless; the first real
 * measurement replaces it.
 */
const UNMEASURED_VIEWPORT = ROW_HEIGHT * 24

const observeRect: typeof observeElementRect = (instance, callback) =>
  observeElementRect(instance, (rect) =>
    callback(rect.height > 0 ? rect : { width: rect.width, height: UNMEASURED_VIEWPORT }),
  )

/**
 * The same rule for a ROW: an unlaid-out row measures 0, and caching 0 for every mounted row
 * collapses the list's height, pulls every later row into the "visible" range, mounts those, and
 * measures them 0 too — an update cascade that ends in React's nested-update limit.
 */
const measureRow: typeof measureElement = (element, entry, instance) => {
  const size = measureElement(element, entry, instance)
  return size > 0 ? size : ROW_HEIGHT
}

export function SchemaTree({
  rows,
  actions,
  ariaLabel,
  className,
  children,
}: {
  rows: readonly SchemaTreeRow[]
  actions: SchemaTreeActions
  ariaLabel: string
  className?: string
  /** Shown below the rows (an empty or no-match hint). */
  children?: ReactNode
}) {
  const indexByKey = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows])
  const firstItemKey = useMemo(() => rows.find(isTreeItem)?.key ?? null, [rows])

  // Roving focus from the MODEL: the remembered row stays the Tab stop while it exists anywhere
  // in the tree, mounted or not, and falls back to the first item when it disappears.
  const [remembered, setRemembered] = useState<string | null>(null)
  const rovingKey = remembered && indexByKey.has(remembered) ? remembered : firstItemKey
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const activeIndex = rovingKey ? (indexByKey.get(rovingKey) ?? -1) : -1
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (activeIndex >= 0 && !indexes.includes(activeIndex)) {
        indexes.push(activeIndex)
        indexes.sort((a, b) => a - b)
      }
      return indexes
    },
    [activeIndex],
  )

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
    rangeExtractor,
    initialRect: { width: 0, height: UNMEASURED_VIEWPORT },
    observeElementRect: observeRect,
    measureElement: measureRow,
  })

  const pendingFocus = useRef<string | null>(null)
  const focusKey = (key: string) => {
    const index = indexByKey.get(key)
    if (index === undefined) return
    pendingFocus.current = key
    setRemembered(key)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }
  useLayoutEffect(() => {
    if (!pendingFocus.current || pendingFocus.current !== rovingKey || !scrollEl) return
    // The target may only mount a frame later, once scrollToIndex widened the window.
    let frame = 0
    const tryFocus = () => {
      const key = pendingFocus.current
      if (!key) return
      // A scan of the mounted window, not an attribute selector: keys are JSON, and quoting JSON
      // inside a CSS string is a parser edge no row lookup should depend on.
      const target = [...scrollEl.querySelectorAll<HTMLElement>('[data-row-key]')].find(
        (element) => element.dataset.rowKey === key,
      )
      if (!target) {
        frame = requestAnimationFrame(tryFocus)
        return
      }
      pendingFocus.current = null
      target.focus({ preventScroll: true })
    }
    tryFocus()
    return () => cancelAnimationFrame(frame)
  }, [rovingKey, rows, scrollEl])

  const rowOf = (target: EventTarget | null): SchemaTreeRow | undefined => {
    if (!(target instanceof Element)) return undefined
    const key = target.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey
    const index = key === undefined ? undefined : indexByKey.get(key)
    return index === undefined ? undefined : rows[index]
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = rowOf(event.target)
    // Only the row element itself: an inline rename or a row's own button owns its keys.
    if (!row || (event.target as HTMLElement).dataset.rowKey !== row.key) return
    if (isSchemaTreeNavKey(event.key)) {
      const nav = schemaTreeNavigation(rows, row.key, event.key)
      if (!nav) return
      event.preventDefault()
      if (nav.kind === 'focus') focusKey(nav.key)
      else {
        const target = rows[indexByKey.get(nav.key) ?? -1]
        if (target && isBranch(target)) actions.setOpen(target, !target.open)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      setSelectedKey(row.key)
      actions.activate(row)
    } else if (event.key === ' ') {
      event.preventDefault()
      if (isBranch(row)) actions.setOpen(row, !row.open)
      else actions.activate(row)
    }
  }

  // ONE delegated menu: the right-clicked row is resolved by its data attribute when the menu
  // opens, and a row with nothing to offer does not open it at all.
  const [menuEntries, setMenuEntries] = useState<readonly MenuEntry[]>([])
  const onContextMenu = (event: React.MouseEvent) => {
    const row = rowOf(event.target)
    const entries = row ? actions.menuFor(row) : null
    if (!entries || entries.length === 0) {
      event.preventDefault()
      return
    }
    if (row) setSelectedKey(row.key)
    setMenuEntries(entries)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setScrollEl}
          role="tree"
          tabIndex={-1}
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          onFocus={(event) => {
            const row = rowOf(event.target)
            if (row && isTreeItem(row)) setRemembered(row.key)
          }}
          onClickCapture={(event) => {
            const row = rowOf(event.target)
            if (row && isTreeItem(row)) setSelectedKey(row.key)
          }}
          className={cn('min-h-0 flex-1 overflow-auto py-1 scrollbar-thin', className)}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  role="none"
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <RowView
                    row={row}
                    tabIndex={row.key === rovingKey ? 0 : -1}
                    selected={row.key === selectedKey}
                    actions={actions}
                  />
                </div>
              )
            })}
          </div>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <MenuEntries entries={menuEntries} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface RowSwitchProps {
  row: SchemaTreeRow
  tabIndex: 0 | -1
  selected: boolean
  actions: SchemaTreeActions
}

function RowSwitch({ row, tabIndex, selected, actions }: RowSwitchProps) {
  const common = { tabIndex, selected, actions }
  switch (row.kind) {
    case 'connection':
      return <ConnectionRowView row={row} {...common} />
    case 'schema':
      return <SchemaRowView row={row} {...common} />
    case 'group':
      return <GroupRowView row={row} {...common} />
    case 'table':
      return <TableRowView row={row} {...common} />
    case 'column':
      return <ColumnRowView row={row} {...common} />
    case 'index':
      return <IndexRowView row={row} {...common} />
    case 'index-label':
      return <IndexLabelRowView row={row} />
    case 'status':
      return <StatusRowView row={row} actions={actions} />
  }
}

/** Rows are rebuilt on every flatten; equal FIELDS (store-owned refs) mean nothing to repaint. */
function sameRow(a: SchemaTreeRow, b: SchemaTreeRow): boolean {
  if (a === b) return true
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.is(left[key], right[key]))
}

const RowView = memo(
  RowSwitch,
  (prev, next) =>
    prev.tabIndex === next.tabIndex &&
    prev.selected === next.selected &&
    prev.actions === next.actions &&
    sameRow(prev.row, next.row),
)
