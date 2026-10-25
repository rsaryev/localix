import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Skeleton } from '@localixai/kit/skeleton'

/** The Store's one scroller: every long list windows itself against it. */
export const StoreScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(null)

/** Rows of a Store list before they are measured; a row with a description is about this tall. */
const ROW_PX = 76
const GAP_PX = 4

/** A loading list: a few rows the shape of the ones to come. */
export function ListSkeleton({ rows = 6, columns = 1 }: { rows?: number; columns?: number }) {
  return (
    <div
      aria-hidden
      className="grid gap-x-4 gap-y-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: rows * columns }, (_, i) => (
        <div key={i} className="flex h-16 items-center gap-3 px-2">
          <Skeleton className="size-11 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * A long Store list, a window of it at a time (`docs/internals/ui-virtualization.md`): rows of
 * `columns` items placed against the Store's scroller, the next page read as the window nears
 * the loaded end. Two thousand plugins mount a screenful, never two thousand cards.
 */
export function PagedList<T>({
  label,
  items,
  columns,
  keyOf,
  render,
  hasMore,
  loadMore,
  loadingMore,
}: {
  label: string
  items: readonly T[]
  columns: number
  keyOf: (item: T) => string
  /** One item as a list item (`<li>`, as `ItemCard` is). */
  render: (item: T) => ReactNode
  hasMore: boolean
  loadMore: () => void
  loadingMore: boolean
}) {
  const scroller = useContext(StoreScrollContext)
  const list = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const el = list.current
    const pane = scroller?.current
    if (!el || !pane) return
    const next = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop
    setMargin((prev) => (Math.abs(prev - next) < 1 ? prev : next))
  })
  const rows = Math.ceil(items.length / columns)
  const virtual = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller?.current ?? null,
    estimateSize: () => ROW_PX + GAP_PX,
    overscan: 6,
    scrollMargin: margin,
    initialRect: { width: 1024, height: 900 },
    getItemKey: (index) => keyOf(items[index * columns]!),
  })
  const windowed = virtual.getVirtualItems()
  const lastShown = windowed.at(-1)?.index ?? -1
  useEffect(() => {
    if (hasMore && !loadingMore && lastShown >= rows - 4) loadMore()
  }, [hasMore, loadingMore, lastShown, rows, loadMore])

  return (
    <section ref={list} aria-label={label} aria-busy={loadingMore || undefined}>
      <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
        {windowed.map((row) => (
          <ul
            key={row.key}
            data-index={row.index}
            ref={virtual.measureElement}
            className="absolute top-0 left-0 grid w-full gap-x-4"
            style={{
              transform: `translateY(${row.start - margin}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              paddingBottom: GAP_PX,
            }}
          >
            {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
              <Fragment key={keyOf(item)}>{render(item)}</Fragment>
            ))}
          </ul>
        ))}
      </div>
      {loadingMore && <ListSkeleton rows={2} columns={columns} />}
    </section>
  )
}
