/** The run bar under the SQL editor: status line (left) + the action cluster (right —
 *  transactions, export, history, filter chip, back, format, explain, stop, run). */
import { useState } from 'react'
import { ArrowLeft, Filter, History, ListChecks, ListTree, WrapText, X } from 'lucide-react'
import { StatusDot } from '@localixai/kit/status-dot'
import { Popover, PopoverTrigger } from '@localixai/kit/popover'
import type { DbDialect } from '../../dbClient'
import type { AdaptedResult } from '../../model/resultAdapter'
import type { SqlConsoleState } from '../../model/useSqlConsole'
import type { SqlHistoryState } from '../../model/useSqlHistory'
import type { RowEditTarget } from '../../model/rowMutations'
import { supportsExplain } from '../../model/sqlExplain'
import { HistoryPopover } from '../HistoryPopover'
import { ConsoleToolButton, RunButton, StopButton } from '../consoleActions'
import { ExportMenu } from './ExportMenu'
import { rowCountLabel, TRUNCATED_HINT } from '../sql-results/format'
import { TxControls } from './TxControls'
import { ProblemStatus } from './ProblemStatus'
import type { SqlProblemSummary } from '../sqlDiagnostics'

export function RunBar({
  c,
  dialect,
  showTransactions,
  result,
  edit,
  history,
  filterCount,
  onClearFilters,
  onBack,
  onRun,
  statementCount = 1,
  onRunAll,
  problems,
  onRevealProblem,
  onExplain,
  onFormat,
  onImportCsv,
}: {
  c: SqlConsoleState
  dialect?: DbDialect
  showTransactions: boolean
  result: AdaptedResult | null | undefined
  edit: RowEditTarget | undefined
  history?: SqlHistoryState
  filterCount: number
  onClearFilters?: () => void
  onBack?: () => void
  onRun: () => void
  /** Top-level statements in the buffer; above one, "Run all" is offered beside Run. */
  statementCount?: number
  onRunAll?: () => void
  /** What the checks found in the text before it runs (live, engine, last failure). */
  problems?: SqlProblemSummary
  onRevealProblem?: () => void
  onExplain: () => void
  onFormat: () => void
  onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}) {
  const [historyOpen, setHistoryOpen] = useState(false)

  // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than the console
  // pane, so this thin action strip read as a black bar under the editor.
  return (
    <div className="flex items-center justify-between gap-2 bg-foreground/[0.04] px-2 py-0.5">
      <div className="flex min-w-0 items-center gap-2 truncate text-2xs text-text-faint">
        {showTransactions && c.txOpen && (
          <span
            title="A manual transaction is open — Commit to persist or Rollback to discard"
            className="flex items-center gap-1 font-medium text-status-warning"
          >
            <StatusDot className="bg-status-warning" />
            Tx open
          </span>
        )}
        {problems && !c.running && <ProblemStatus problems={problems} onReveal={onRevealProblem} />}
        {/* `min-w-0 truncate`: the parent truncates, but a shrink-0 child never let it — the hint
            was clipped mid-word with no ellipsis. */}
        <span className="min-w-0 truncate">
          {c.running ? (
            'Running…'
          ) : c.outcome ? (
            <ResultStatus outcome={c.outcome} rowCount={c.sortedRows.length} total={c.totalRows} />
          ) : showTransactions && c.txNotice ? (
            c.txNotice
          ) : statementCount > 1 ? (
            `⌘/Ctrl + Enter runs the statement under the cursor · ${statementCount} statements in the editor`
          ) : (
            '⌘/Ctrl + Enter runs the statement under the cursor'
          )}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {showTransactions && <TxControls c={c} />}
        {(result || edit) && (
          <ExportMenu rows={c.sortedRows} result={result} edit={edit} onImportCsv={onImportCsv} />
        )}
        {history && history.entries.length > 0 && (
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              {/* The open state rides the ghost variant's own `aria-expanded` step. */}
              <ConsoleToolButton title="Query history">
                <History className="size-3" />
                History
              </ConsoleToolButton>
            </PopoverTrigger>
            <HistoryPopover history={history} onPick={c.setSql} />
          </Popover>
        )}
        {filterCount > 0 && onClearFilters && (
          <ConsoleToolButton
            onClick={onClearFilters}
            title="Clear all filters"
            // Chip veil + the 7% hover, not `bg-accent/10|/20`: `accent` is itself a 6% veil under
            // glass, so those were 0.6%/1.2% fills — the chip and its hover both disappeared.
            className="bg-foreground/[0.06] text-foreground"
          >
            <Filter className="size-3" />
            {filterCount} {filterCount === 1 ? 'filter' : 'filters'}
            <X className="size-3" />
          </ConsoleToolButton>
        )}
        {onBack && (
          <ConsoleToolButton onClick={onBack} title="Back to the table you drilled from">
            <ArrowLeft className="size-3" />
            Back
          </ConsoleToolButton>
        )}
        <ConsoleToolButton
          onClick={onFormat}
          title="Format SQL (⇧⌥F) — uppercase keywords + one clause per line"
        >
          <WrapText className="size-3" />
          Format
        </ConsoleToolButton>
        {dialect && supportsExplain(dialect) && (
          <ConsoleToolButton
            onClick={onExplain}
            disabled={c.running}
            title="Explain — run the query plan for the focused statement (does not execute it)"
          >
            <ListTree className="size-3" />
            Explain
          </ConsoleToolButton>
        )}
        {c.running && <StopButton onClick={c.cancel} />}
        {statementCount > 1 && onRunAll && (
          <ConsoleToolButton
            onClick={onRunAll}
            disabled={c.running}
            title="Run every statement in the editor, in order, stopping at the first failure"
          >
            <ListChecks className="size-3" />
            Run all ({statementCount})
          </ConsoleToolButton>
        )}
        <RunButton
          running={c.running}
          onClick={onRun}
          disabled={c.running}
          title="Run (⌘/Ctrl + Enter) — runs the selection if any is highlighted"
        />
      </div>
    </div>
  )
}

function ResultStatus({
  outcome,
  rowCount,
  total,
}: {
  outcome: SqlConsoleState['outcome']
  rowCount: number
  total: number
}) {
  if (!outcome) return null
  const ms = outcome.durationMs < 1 ? '<1' : Math.round(outcome.durationMs).toString()
  if (outcome.result) {
    // "N of M" when a client-side filter is hiding rows; "first" when the engine had more.
    const truncated = outcome.result.truncated === true
    return (
      <span {...(truncated ? { title: TRUNCATED_HINT, className: 'text-status-warning' } : {})}>
        {rowCountLabel(rowCount, total, truncated)} · {ms} ms
      </span>
    )
  }
  return (
    <span>
      {outcome.ddl ? 'Completed' : `${outcome.rowsAffected ?? 0} affected`} · {ms} ms
    </span>
  )
}
