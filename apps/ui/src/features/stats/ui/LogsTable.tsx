import { useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { UsageLogRow } from '@/shared/api/contracts'
import { useInfiniteScroll, useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { LogRow } from './LogRow'
import { TABLE_STICKY_HEAD, TABLE_TH } from './tableCells'

interface LogsTableProps {
  rows: UsageLogRow[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error?: unknown
  onLoadMore: () => void
  onOpenSession?: (sessionId: string) => void
}

const TH = cn(TABLE_TH, 'whitespace-nowrap')
/** One single-line row: `py-2` twice plus the `text-sm` line box. */
const ROW_H = 36

export function LogsTable({
  rows,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onLoadMore,
  onOpenSession,
}: LogsTableProps) {
  const sentinelRef = useInfiniteScroll(onLoadMore, hasMore && !isLoadingMore && !isLoading)
  // The stats panel can be parked as a warm-hidden work item; a hidden surface
  // reports zero-sized geometry, so measurement is disabled while it is parked.
  const workItemVisible = useWorkItemVisible()
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  // Paging appends without bound (50 rows a page, no ceiling), so the body mounts a
  // window instead of every loaded row. Spacer rows above and below the window keep
  // the table's scroll height — which is what keeps the sentinel below at the true
  // tail, so infinite scroll and follow-the-tail behave exactly as before.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_H,
    overscan: 16,
    getItemKey: (index) => rows[index]?.messageId ?? index,
    enabled: workItemVisible,
  })
  // Above the early returns, and null while the read works — the request log is its own subject,
  // separate from the overview the panel owns, so the two never settle each other.
  const problem = useProblemReport(
    error
      ? {
          subject: { label: 'Request log' },
          consequence: rows.length > 0 ? 'stale' : 'blocked',
          problems: [
            {
              message: 'The request log could not be read.',
              detail: errorMessage(error, '') || undefined,
            },
          ],
        }
      : null,
    { scope: 'stats' },
  )

  const items = virtualizer.getVirtualItems()
  const paddingTop = items.length > 0 ? items[0]!.start : 0
  const paddingBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1]!.end : 0

  if (isLoading && rows.length === 0) {
    return <LoadingHint className="py-8 text-xs" />
  }
  if (rows.length === 0) {
    return problem ? (
      <div className="py-8">
        <ProblemLine {...problem} className="items-center" />
      </div>
    ) : (
      <EmptyHint className="py-8 text-xs">No requests recorded yet.</EmptyHint>
    )
  }

  return (
    <div>
      {/* Capped, scrollable viewport — rows stream in via the sentinel below. */}
      <div ref={setScrollEl} className="max-h-96 overflow-auto scrollbar-thin virtual-scroller">
        <table className="w-full text-sm">
          <thead className={TABLE_STICKY_HEAD}>
            <tr className="border-b border-border-faint text-left text-text-faint">
              <th className={TH}>Date</th>
              <th className={TH}>Model</th>
              <th className={TH}>Provider</th>
              <th className={TH}>Session</th>
              <th className={cn(TH, 'text-right')}>Total</th>
              <th
                className={cn(TH, 'text-right')}
                title="Total context tokens sent (includes cache)"
              >
                Input
              </th>
              <th className={cn(TH, 'text-right')}>Output</th>
              <th className={cn(TH, 'text-right')} title="Cache writes (new cache)">
                Cache↑
              </th>
              <th className={cn(TH, 'text-right')} title="Cache reads (cache hit)">
                Cache↓
              </th>
              <th className={cn(TH, 'text-right')}>Cost</th>
              <th className={TH}>Duration</th>
              <th className={TH}>Type</th>
              <th className={TH}>Finish</th>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && <tr aria-hidden style={{ height: paddingTop }} />}
            {items.map((item) => {
              const row = rows[item.index]
              return row ? (
                <LogRow
                  key={item.key}
                  row={row}
                  index={item.index}
                  measureRef={virtualizer.measureElement}
                  onOpenSession={onOpenSession}
                />
              ) : null
            })}
            {paddingBottom > 0 && <tr aria-hidden style={{ height: paddingBottom }} />}
          </tbody>
        </table>
        {/* Infinite-scroll trigger + status line. */}
        {hasMore && <div ref={sentinelRef} className="h-1" />}
        {problem ? (
          // A page that failed mid-list: the rows above are still true, so the line sits at the
          // tail where the missing ones would have been rather than replacing the table.
          <div className="flex justify-center py-3">
            <ProblemLine {...problem} />
          </div>
        ) : (
          (isLoadingMore || hasMore) && (
            <div className="flex justify-center py-3 text-2xs text-text-faint">
              {isLoadingMore ? <ActivitySignal label="Loading more" /> : 'Scroll for more'}
            </div>
          )
        )}
      </div>
    </div>
  )
}
