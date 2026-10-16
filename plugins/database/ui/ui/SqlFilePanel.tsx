import { Database, Plug, FastForward, ListTree, WrapText } from 'lucide-react'
import type { DbConnectionInfo, DbErrorCode } from '../dbClient'
import { DIALECT_LABEL } from '../model/dialects'
import type { SortSpec } from '@localixai/dataview'
import { StatusDot } from '@localixai/kit/status-dot'
import { connectionDotClass } from '../model/connectionColor'
import type { ResultOutcome } from '../model/resultTabs'
import type { SqlConsoleState } from '../model/useSqlConsole'
import { ConnectionBadges } from './ConnectionBadge'
import { ConsoleToolButton, RunButton, StopButton } from './consoleActions'
import { PickMenu } from './PickMenu'
import { SqlResultsView } from './SqlResultsView'
import { ProblemStatus } from './sql-console/ProblemStatus'
import type { SqlProblemSummary } from './sqlDiagnostics'
import { rowCountLabel, TRUNCATED_HINT } from './sql-results/format'

/**
 * The bottom region docked under a .sql file in the code editor: a run bar (a
 * connection picker when several databases are live + a Run button + status line) over
 * the shared results grid. Purely presentational — the editor host owns the run
 * lifecycle and connection state. When no database is connected it shows a gentle hint
 * with a shortcut into the workbench instead of the Run controls.
 */
export function SqlFilePanel({
  fileName,
  live,
  active,
  onSelectConnection,
  running,
  outcome,
  error,
  errorCode,
  errorDetail,
  rows,
  sort,
  toggleSort,
  filter,
  onFilterChange,
  totalRows,
  onRun,
  onRunFile,
  onExplain,
  onFormat,
  onStop,
  onOpenWorkbench,
  problems,
  onRevealProblem,
}: {
  /** The .sql file this panel is docked under — half of the identity a failed statement is filed under. */
  fileName: string
  live: DbConnectionInfo[]
  active: DbConnectionInfo | null
  onSelectConnection: (id: string) => void
  running: boolean
  outcome: ResultOutcome | null
  error: string | null
  errorCode?: DbErrorCode | null
  errorDetail?: string | null
  rows: SqlConsoleState['sortedRows']
  sort: SortSpec | undefined
  toggleSort: (columnId: string) => void
  filter?: string
  onFilterChange?: (query: string) => void
  totalRows?: number
  onRun: () => void
  /** Run every statement in the file in order (execute-script), stopping at the first error. */
  onRunFile?: () => void
  /** Explain the focused statement's query plan (hidden on dialects without portable EXPLAIN). */
  onExplain?: () => void
  /** Format the whole file in place (conservative pretty-printer). */
  onFormat?: () => void
  onStop?: () => void
  onOpenWorkbench: () => void
  /** What the checks found in the file before it runs; click reveals the first. */
  problems?: SqlProblemSummary
  onRevealProblem?: () => void
}) {
  // No fill at all: this panel FILLS the bottom pane of the SQL file tab, and a pane inherits the
  // ground of the pane it is mounted into. `--surface-sunken` is a veil rather than a second
  // ground, but a pane-sized veil still darkens the whole panel against the editor above it; the
  // recess is carried by the border-t, which is what a seam between panes is for.
  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border-soft">
      {/* No fill: the panel above already painted this inset's ground (double-coat). */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
        {active ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              {live.length > 1 ? (
                <div className="flex items-center gap-1">
                  <Database className="size-3 shrink-0 text-text-faint" />
                  <PickMenu
                    size="sm"
                    align="start"
                    label={active.name}
                    aria-label="Database this file runs against"
                    className="max-w-64 text-2xs"
                    entries={live.map((c) => ({
                      id: c.id,
                      label: c.name,
                      // The engine is a fact about the row, not part of its name.
                      hint: DIALECT_LABEL[c.dialect],
                      selected: c.id === active.id,
                      onSelect: () => onSelectConnection(c.id),
                    }))}
                  />
                </div>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5 text-2xs text-text-soft">
                  <StatusDot className="bg-status-success" label="Connected" />
                  <span className="truncate">{active.name}</span>
                  <span className="uppercase text-text-faint">{active.dialect}</span>
                </span>
              )}
              {connectionDotClass(active.color) && (
                <StatusDot
                  className={connectionDotClass(active.color) ?? undefined}
                  label="Color tag"
                />
              )}
              {/* The shared RO tag, not a sixth transcription of the chip recipe. */}
              <ConnectionBadges readonly={active.readonly} />

              {problems && !running && (
                <span className="ml-1 min-w-0 text-2xs">
                  <ProblemStatus problems={problems} onReveal={onRevealProblem} />
                </span>
              )}
              <span className="ml-1 truncate text-2xs text-text-faint">
                {running ? (
                  'Running…'
                ) : outcome ? (
                  <ResultStatus outcome={outcome} rowCount={rows.length} />
                ) : (
                  '⌘/Ctrl + Enter · select to run part'
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {running && onStop && <StopButton onClick={onStop} />}
              {onExplain && (
                <ConsoleToolButton
                  onClick={onExplain}
                  disabled={running}
                  title="Explain — run the query plan for the focused statement (does not execute it)"
                >
                  <ListTree className="size-3" />
                  Explain
                </ConsoleToolButton>
              )}
              {onFormat && (
                <ConsoleToolButton
                  onClick={onFormat}
                  title="Format SQL — uppercase keywords + one clause per line"
                >
                  <WrapText className="size-3" />
                  Format
                </ConsoleToolButton>
              )}
              {onRunFile && (
                <ConsoleToolButton
                  onClick={onRunFile}
                  disabled={running}
                  title="Run file — execute every statement in order, stopping at the first error"
                >
                  <FastForward className="size-3" />
                  Run file
                </ConsoleToolButton>
              )}
              <RunButton
                running={running}
                onClick={onRun}
                disabled={running}
                title="Run the statement under the cursor (⌘/Ctrl + Enter) — or the selection if any is highlighted"
              />
            </div>
          </>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-2xs text-text-faint">
              <Plug className="size-3 shrink-0" />
              Connect a database to run this file.
            </span>
            <ConsoleToolButton onClick={onOpenWorkbench} className="shrink-0">
              <Database className="size-3" />
              Databases
            </ConsoleToolButton>
          </div>
        )}
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <SqlResultsView
          subject={active ? `${fileName} · ${active.name}` : fileName}
          error={error}
          errorCode={errorCode}
          errorDetail={errorDetail}
          outcome={outcome}
          rows={rows}
          sort={sort}
          toggleSort={toggleSort}
          filter={filter}
          onFilterChange={onFilterChange}
          total={totalRows}
          emptyHint={active ? 'Run a statement to see results.' : 'No database connected.'}
        />
      </div>
    </div>
  )
}

function ResultStatus({ outcome, rowCount }: { outcome: ResultOutcome; rowCount: number }) {
  const ms = outcome.durationMs < 1 ? '<1' : Math.round(outcome.durationMs).toString()
  if (outcome.result) {
    const truncated = outcome.result.truncated === true
    return (
      <span {...(truncated ? { title: TRUNCATED_HINT, className: 'text-status-warning' } : {})}>
        {rowCountLabel(rowCount, rowCount, truncated)} · {ms} ms
      </span>
    )
  }
  return (
    <span>
      {outcome.rowsAffected ?? 0} affected · {ms} ms
    </span>
  )
}
