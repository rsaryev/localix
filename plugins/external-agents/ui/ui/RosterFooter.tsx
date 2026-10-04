import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'

/**
 * The bound report under the roster.
 *
 * WHY it is unconditional whenever anything was withheld: the roster is a bounded window over a
 * set that can be far larger, and a list that silently stops at its limit is indistinguishable
 * from a complete one. Stating the shortfall — and what to do about it — is the contract behind
 * every `Bounded<T>` response.
 */
export function RosterFooter({
  shown,
  total,
  withheld,
  loadingMore,
  live,
  refreshReason,
}: {
  shown: number
  total: number
  withheld: number
  loadingMore: boolean
  /** Why the list refreshes as often as it does — an idle-looking roster explaining itself. */
  refreshReason?: string
  /** Delegations running right now. Called out because it is the one number that changes while
   *  you are looking at it, and the roster's sort puts them on top where a count is not obvious. */
  live: number
}) {
  return (
    <WorkbenchStatusBar aria-label="Roster summary">
      <WorkbenchStatusItem>
        {withheld > 0
          ? `Showing ${shown} of ${total}. ${withheld} not shown — narrow the filter.`
          : `Showing ${shown} of ${total}.`}
      </WorkbenchStatusItem>
      <span className="ml-auto flex min-w-0 items-stretch">
        {live > 0 && (
          <WorkbenchStatusItem className="text-text-soft">{live} running now</WorkbenchStatusItem>
        )}
        {refreshReason && <WorkbenchStatusItem title={refreshReason}>·</WorkbenchStatusItem>}
        {loadingMore && <WorkbenchStatusItem>Loading more…</WorkbenchStatusItem>}
      </span>
    </WorkbenchStatusBar>
  )
}
