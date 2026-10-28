import { CheckCircle2 } from 'lucide-react'
import { isNumericType, type SortSpec, type TableRow } from '@localixai/dataview'
import type { DbErrorCode } from '../dbClient'
import { TableGrid } from '@localixai/mini-app-sdk/ui/components'
import { ChartView } from '@localixai/mini-app-sdk/ui/charts'
import { EmptyHint } from '@localixai/kit/empty-hint'
import type { MutationTarget } from '../model/rowMutations'
import { rowToInsert } from '../model/rowCopy'
import type { ResultOutcome } from '../model/resultTabs'
import type { SqlConsoleState } from '../model/useSqlConsole'
import { fmtMs } from './sql-results/format'
import { useQueryErrorState } from './sql-results/QueryErrorState'
import { ResultFooter } from './sql-results/ResultFooter'
import { ResultToolbar } from './sql-results/ResultToolbar'
import { resolveChartSpec, useChartState } from './sql-results/useChartState'

/**
 * The results region shared by the SQL console and the .sql-file runner: engine error,
 * the virtualized data grid, an "N rows affected" line for non-row statements, or an
 * empty hint. Pure presentation — no run lifecycle, no row-editing drawer (the console
 * layers that alongside this).
 */
export function SqlResultsView({
  subject,
  error,
  errorCode,
  errorDetail,
  outcome,
  rows,
  sort,
  toggleSort,
  onRowActivate,
  emptyHint = 'Run a query to see results.',
  editable,
  editableColumns,
  onCellEdit,
  onCommitChanges,
  onAddRow,
  onDeleteRow,
  filter,
  onFilterChange,
  total,
  linkColumns,
  onCellLink,
  onCellFilter,
  onColumnFilter,
  pkColumns,
  edit,
  showResultFooter = true,
}: {
  /**
   * The console this result belongs to, named the way a person would name it ("shop · orders",
   * "analytics — report.sql"). It is the identity of the Event Center row a failure publishes, so
   * two consoles failing at once must not share one.
   */
  subject: string
  error: string | null
  errorCode?: DbErrorCode | null
  /** Raw engine detail (e.g. "Duplicate entry '1' for key 'PRIMARY'"), shown beneath the
   *  friendly title in place of the generic message when present. */
  errorDetail?: string | null
  outcome: ResultOutcome | null
  rows: SqlConsoleState['sortedRows']
  sort: SortSpec | undefined
  toggleSort: (columnId: string) => void
  onRowActivate?: (index: number) => void
  /** Client-side result filter (substring across all columns). When onFilterChange is
   *  given, a filter box shows above the grid; `total` is the pre-filter row count. */
  filter?: string
  onFilterChange?: (query: string) => void
  total?: number
  /** Foreign-key link columns (id set) + click handler → open the referenced row. */
  linkColumns?: Set<string>
  onCellLink?: (columnId: string, value: unknown) => void
  /** Filter the browsed table by a cell's value (hover funnel on each cell). */
  onCellFilter?: (columnId: string, value: unknown) => void
  /** Filter the browsed table by a per-column header funnel (typed substring/LIKE). */
  onColumnFilter?: (columnId: string, value: string) => void
  /** Result column ids that map to the browsed table's primary key (key glyph in header). */
  pkColumns?: Set<string>
  /** The browsed single-table target (when the result maps to a known editable table).
   *  Threaded to the grid as `copyTarget` so each row's right-click menu offers "Copy row
   *  as INSERT"; absent for ad-hoc queries / non-table results, which hide that action. */
  edit?: MutationTarget
  emptyHint?: string
  /** Opt-in inline editing (single-table + PK gate lives in the console). */
  editable?: boolean
  /** Grid column ids proven to be direct physical columns. Omit for a table browser. */
  editableColumns?: Set<string>
  onCellEdit?: (row: TableRow, columnId: string, next: string | null) => void
  /** Staged-edit batch commit (see TableGrid). When set, cell edits + inserts + deletes
   *  stage until Commit. */
  onCommitChanges?: (changes: {
    updates: { row: TableRow; values: Record<string, string | null> }[]
    inserts: Record<string, string | null>[]
    deletes: TableRow[]
  }) => Promise<boolean>
  onAddRow?: (values: Record<string, string | null>) => void
  onDeleteRow?: (row: TableRow) => void
  /**
   * Render the row-count/duration footer. Off for a caller that owns its OWN status line.
   *
   * The table workspace does: it adds a pagination footer of its own directly below this one, so the
   * bottom carried TWO adjacent bars stating the row count in different vocabularies ("50 rows ·
   * 12ms" above "Rows 1–50 … Page 1"). One of them had to go, and the pagination owner is the one
   * that knows the page.
   */
  showResultFooter?: boolean
}) {
  const chart = useChartState()
  const { setChartEl } = chart
  // Owned above the branch: the branch vanishes when the next query works, and an owner that
  // vanishes never settles the row it published.
  const failure = useQueryErrorState({ subject, error: error ?? null, errorCode, errorDetail })

  if (error) return failure
  if (outcome?.result) {
    const columns = outcome.result.columns
    const totalRows = total ?? rows.length
    const canChart = columns.some((col) => isNumericType(col.type))
    const showChart = chart.view === 'chart' && canChart
    const chartSpec = resolveChartSpec(chart.chartKind, columns, chart.xCol, chart.yCol)
    return (
      <div className="flex h-full min-h-0 flex-col">
        {(onFilterChange || canChart) && totalRows > 0 && (
          <ResultToolbar
            columns={columns}
            chart={chart}
            showChart={showChart}
            canChart={canChart}
            filter={filter}
            onFilterChange={onFilterChange}
          />
        )}
        <div className="min-h-0 flex-1">
          {showChart ? (
            <div ref={setChartEl} className="h-full w-full">
              <ChartView columns={columns} rows={rows} spec={chartSpec} />
            </div>
          ) : (
            <TableGrid
              columns={columns}
              rows={rows}
              total={rows.length}
              showColumnTypes
              pkColumns={pkColumns}
              sort={sort}
              onToggleSort={toggleSort}
              onReachEnd={() => {}}
              onRowActivate={onRowActivate}
              editable={editable}
              editableColumns={editableColumns}
              onCellEdit={onCellEdit}
              onCommitChanges={onCommitChanges}
              onAddRow={onAddRow}
              onDeleteRow={onDeleteRow}
              linkColumns={linkColumns}
              onCellLink={onCellLink}
              onCellFilter={onCellFilter}
              onColumnFilter={onColumnFilter}
              extraRowCopy={
                edit
                  ? {
                      label: 'Copy row as INSERT',
                      toText: (cols, row) => rowToInsert(edit, cols, row, outcome.result!),
                    }
                  : undefined
              }
            />
          )}
        </div>
        {showResultFooter && (
          <ResultFooter
            shownRows={rows.length}
            totalRows={totalRows}
            truncated={outcome.result.truncated === true}
            durationMs={outcome.durationMs}
          />
        )}
      </div>
    )
  }
  if (outcome) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="size-6 text-status-success/80" />
          <div className="text-sm text-text-soft">
            {outcome.ddl
              ? 'Statement completed'
              : `${outcome.rowsAffected ?? 0} row${outcome.rowsAffected === 1 ? '' : 's'} affected`}
          </div>
          <div className="text-2xs text-text-faint">{fmtMs(outcome.durationMs)}</div>
        </div>
      </div>
    )
  }
  return <EmptyHint className="text-xs">{emptyHint}</EmptyHint>
}
