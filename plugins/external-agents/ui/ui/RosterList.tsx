import { useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ProviderStatus, RosterRow } from '../model/types'
import { ROSTER_ROW_HEIGHT, RosterRowView } from './RosterRowView'

/**
 * The roster viewport.
 *
 * VIRTUALIZED, not merely long: the design point is thousands of discovered sessions across four
 * providers, and a plain `.map()` there costs one DOM subtree per row — each with a popover
 * trigger — which is what makes an unbounded roster unusable. `useVirtualizer` renders only the
 * visible window plus a small overscan.
 */
export function RosterList({
  rows,
  providers,
  onReachEnd,
}: {
  rows: readonly RosterRow[]
  providers: readonly ProviderStatus[]
  onReachEnd: () => void
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const displayNames = new Map(providers.map((p) => [p.provider, p.displayName]))

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns mutable measurement helpers by design.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport,
    estimateSize: () => ROSTER_ROW_HEIGHT,
    overscan: 10,
    // Key by the roster key, not the index: rows shift position when a page appends or a live row
    // sorts to the front, and index keys would recycle a row's popover state onto a different row.
    getItemKey: (index) => rows[index]?.key ?? index,
    // Rows have no measurable box before the panel is laid out (and none at all in a DOM test
    // without layout). A seed rect keeps the first paint from rendering zero rows.
    initialRect: { width: 720, height: 640 },
  })

  const virtualRows = virtualizer.getVirtualItems()
  const lastIndex = virtualRows.at(-1)?.index ?? -1

  useEffect(() => {
    // Paging is driven by the LAST RENDERED index rather than a scroll offset, so it works the
    // same whether the user scrolled, resized, or the window simply grew.
    if (rows.length === 0) return
    if (lastIndex >= rows.length - 1) onReachEnd()
  }, [lastIndex, rows.length, onReachEnd])

  return (
    <div
      ref={setViewport}
      role="list"
      aria-label="External agent sessions"
      data-scrollable
      className="scrollbar-thin virtual-scroller min-h-0 flex-1 overflow-auto"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              className="absolute inset-x-0 top-0"
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              <RosterRowView
                row={row}
                providerName={displayNames.get(row.provider) ?? row.provider}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
