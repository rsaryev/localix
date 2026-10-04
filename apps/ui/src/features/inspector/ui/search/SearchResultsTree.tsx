/**
 * SearchResultsTree — geometry for the content-search results.
 *
 * The results are the highest-count list in the workbench: the backend returns up to
 * 1000 matches, the tree defaults fully expanded, and every match renders a
 * slice-highlighted line plus its optional context lines. Rendering that whole tree
 * mounted several thousand nodes at once, so this owns the scroll element and a
 * `@tanstack/react-virtual` window over the flat row model — the same arrangement the
 * Explorer uses (`FileTreeSidebar` + `FileTreeEntries`).
 *
 * Rows are variable-height: a match with context lines is taller than one without, and
 * folder/file headers use a different text tier again. `estimateSearchRowSize` seeds the
 * scrollbar per row kind and `measureElement` corrects each row once it mounts.
 */
import { useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import type { ContentSearch } from './useContentSearch'
import { SearchRowView } from './SearchTreeView'
import { estimateSearchRowSize, flattenSearchRows } from './searchTreeRows'

export function SearchResultsTree({ cs }: { cs: ContentSearch }) {
  const rows = useMemo(() => flattenSearchRows(cs.tree, cs.collapsed), [cs.tree, cs.collapsed])
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (index) => estimateSearchRowSize(rows[index]),
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  const searching = cs.loading && cs.matches.length === 0
  return (
    <div
      ref={setScrollEl}
      className="min-h-0 flex-1 overflow-auto scrollbar-thin virtual-scroller pb-2"
    >
      {searching ? (
        <ActivitySignal
          label="Searching"
          className="h-full justify-center text-xs text-text-faint"
          labelClassName="min-w-0"
        />
      ) : (
        <div
          className="pointer-events-none relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (!row) return null
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="pointer-events-auto absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <SearchRowView
                  row={row}
                  toggle={cs.toggleNode}
                  sessionId={cs.sessionId}
                  root={cs.root}
                  previewFor={cs.previewFor}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
