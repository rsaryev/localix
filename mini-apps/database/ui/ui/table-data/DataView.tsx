/** A database object's Data view: the editable result grid over one browsed page, and the one
 * status line that states the row range and pages it. */
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ProblemLine, type MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import type { DbConnectionInfo } from '../../dbClient'
import type { RowEditTarget } from '../../model/rowMutations'
import { SqlResultsView } from '../SqlResultsView'
import { fmtMs } from '../sql-results/format'
import type { useRowEditing } from '../sql-console/useRowEditing'
import { PAGE_SIZE, type BrowsePage } from './useBrowsePage'

export function DataView({
  connection,
  browse,
  editTarget,
  pkColumns,
  commitChanges,
  editProblem,
}: {
  connection: DbConnectionInfo
  browse: BrowsePage
  editTarget: RowEditTarget | undefined
  pkColumns: Set<string> | undefined
  commitChanges: ReturnType<typeof useRowEditing>['commitChanges']
  editProblem: MiniAppProblemLineProps | null
}) {
  const { page, result, loading, error, durationMs } = browse
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <SqlResultsView
          key={browse.dataScopeKey}
          subject={`${connection.name} · ${browse.qualifiedName}`}
          error={error?.message ?? null}
          errorCode={error?.code}
          errorDetail={error?.detail ?? null}
          outcome={result ? { result, durationMs } : null}
          rows={browse.visibleRows}
          sort={browse.sort}
          toggleSort={browse.toggleSort}
          filter={browse.filter}
          onFilterChange={browse.setFilter}
          total={result?.rows.length ?? 0}
          // Existing rows require a stable PK identity; inserting a new row does not.
          // The grid therefore keeps Add row available on every writable table while
          // enabling inline update/delete only when the table has a primary key.
          editable={!!editTarget?.pk.length}
          onCommitChanges={editTarget ? commitChanges : undefined}
          pkColumns={pkColumns}
          edit={editTarget}
          emptyHint={`No rows in ${browse.qualifiedName}.`}
          // This view owns the status line below (it is the half that knows the page), so
          // the shared result footer would be a second bar stating the row count again.
          showResultFooter={false}
        />
      </div>
      {editProblem && <ProblemLine {...editProblem} className="shrink-0 px-3 py-1.5" />}
      {/* ONE status line. It used to be two adjacent bars — the shared `ResultFooter` ("50
          rows · 12ms") directly above this one ("Rows 1–50 … Page 1") — which stated the row
          count twice, in two vocabularies, and added a second border across the bottom. */}
      <WorkbenchStatusBar aria-label="Row range and paging" seam="top">
        <WorkbenchStatusItem>
          Rows {page * PAGE_SIZE + (result?.rows.length ? 1 : 0)}–
          {page * PAGE_SIZE + (result?.rows.length ?? 0)}
        </WorkbenchStatusItem>
        {durationMs > 0 && <WorkbenchStatusItem>{fmtMs(durationMs)}</WorkbenchStatusItem>}
        <WorkbenchStatusItem className="ml-auto">Page {page + 1}</WorkbenchStatusItem>
        <span className="flex shrink-0 items-center gap-0.5 pr-1">
          <IconButton
            size="xs"
            tooltip="Previous page"
            aria-label="Previous page"
            disabled={page === 0 || loading}
            onClick={() => browse.setPage((value) => Math.max(0, value - 1))}
          >
            <ArrowLeft className="size-3" />
          </IconButton>
          <IconButton
            size="xs"
            tooltip="Next page"
            aria-label="Next page"
            disabled={!browse.hasNext || loading}
            onClick={() => browse.setPage((value) => value + 1)}
          >
            <ArrowRight className="size-3" />
          </IconButton>
        </span>
      </WorkbenchStatusBar>
      {loading && !result && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <Spinner className="size-4" />
        </div>
      )}
    </div>
  )
}
