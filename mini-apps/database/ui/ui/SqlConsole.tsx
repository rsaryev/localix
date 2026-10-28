import { useMemo, useRef } from 'react'
import type { DbDialect } from '../dbClient'
import { CodeEditor, type CompletionSource, type NextEditSource } from '@localixai/kit/code-editor'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SqlConsoleState } from '../model/useSqlConsole'
import type { SqlHistoryState } from '../model/useSqlHistory'
import { usePaneResize } from '@localixai/kit/pane-resize'
import type { RowEditTarget } from '../model/rowMutations'
import { splitStatements, statementToRun } from '../../shared/sql-statements'
import { explainQuery } from '../model/sqlExplain'
import { formatSql } from '../model/formatSql'
import { RunBar } from './sql-console/RunBar'
import { ResultsArea } from './sql-console/ResultsArea'
import { useEditorIntegration } from './sql-console/useEditorIntegration'
import type { SqlCatalog } from '../model/sql-diagnostics/catalog'
import type { SqlEngineProblem } from './sqlDiagnostics'
import { useRowEditing } from './sql-console/useRowEditing'
import { QueryParametersDialog } from './QueryParametersDialog'

/** Presentational SQL console — editor + run bar + results. State lives in useSqlConsole;
 *  the pieces (run bar, results area, editor integration, row editing) live in
 *  `sql-console/`. This file owns the layout + the run/explain actions. */
/**
 * Vertical space the results half must always keep: the divider, the results toolbar and
 * a couple of grid rows. The editor pane can never grow past `container - this`, so the
 * divider stays reachable no matter how short the console gets.
 */
const RESULTS_MIN_HEIGHT = 132

export function SqlConsole({
  console: c,
  dialect,
  completionSource,
  nextEditSource,
  history,
  edit,
  linkColumns,
  onCellLink,
  onCellFilter,
  onColumnFilter,
  filterCount = 0,
  onClearFilters,
  onBack,
  showTransactions = false,
  tableNames,
  onOpenTable,
  columnNames,
  catalog,
  onWantColumns,
  engineCheck,
  connectionLabel,
}: {
  console: SqlConsoleState
  /** Drives the query-plan "Explain" action (hidden on dialects without portable EXPLAIN). */
  dialect?: DbDialect
  completionSource?: CompletionSource
  /** AI edit-prediction source — after an edit + pause, propose the next SQL edit
   *  (rendered as the inline mini-diff decoration; Tab jump/accept, Esc dismiss). */
  nextEditSource?: NextEditSource
  history?: SqlHistoryState
  /** When set (browsing a table with a PK), rows are editable. */
  edit?: RowEditTarget
  /** Foreign-key link columns (result column ids) + open-referenced-row handler. */
  linkColumns?: Set<string>
  onCellLink?: (columnId: string, value: unknown) => void
  /** Filter the browsed table by a cell's value (hover funnel on each cell). */
  onCellFilter?: (columnId: string, value: unknown) => void
  /** Filter the browsed table by a per-column header funnel (typed substring/LIKE). */
  onColumnFilter?: (columnId: string, value: string) => void
  /** Number of active filter-by-value predicates on the browsed table (drives the chip). */
  filterCount?: number
  /** Clear all active filter-by-value predicates at once. */
  onClearFilters?: () => void
  /** When set, a Back affordance returns to the table a foreign-key jump drilled from. */
  onBack?: () => void
  /** Show the manual-transaction control (Tx: Auto/Manual + Commit/Rollback). SQL,
   *  writable connections only — hidden for read-only (writes are blocked even in a tx). */
  showTransactions?: boolean
  /** Known table names (lower-cased match), for ⌘/Ctrl-click-to-open links in the editor. */
  tableNames?: ReadonlySet<string>
  /** Open a table the user ⌘/Ctrl-clicked in the SQL editor. */
  onOpenTable?: (table: string) => void
  /** Known column names (lower-cased), subtly tinted in the editor as column references. */
  columnNames?: ReadonlySet<string>
  /** The connection's schema, for live diagnostics (unknown table / column / alias). */
  catalog?: SqlCatalog | null
  /** Load the structures a diagnostic needed; the check re-runs when they arrive. */
  onWantColumns?: (tables: Array<{ name: string; schema: string }>) => void
  /** The engine's compile-without-running check, for syntax and type errors before a run. */
  engineCheck?: ((sql: string) => Promise<SqlEngineProblem[]>) | null
  /** Connection name — names this console's failures in the Event Center. */
  connectionLabel?: string
}) {
  const editor = useEditorIntegration({
    tableNames,
    onOpenTable,
    columnNames,
    catalog,
    dialect,
    onWantColumns,
    runFailure: c.lastFailure,
    engineCheck,
  })
  const result = c.outcome?.result
  const editable = edit && result
  const rowEditing = useRowEditing({ edit, result, setSql: c.setSql })

  // Map the browsed table's PK column names → the current result's column ids, so the grid
  // header can badge them with a key glyph. Only meaningful while browsing that table.
  const pkColumns = useMemo(() => {
    if (!edit || !result) return undefined
    const pk = new Set(edit.pk)
    const ids = new Set<string>()
    for (const col of result.columns) {
      const source = edit.sourceColumnById?.[col.id] ?? col.title
      if (pk.has(source)) ids.add(col.id)
    }
    return ids.size > 0 ? ids : undefined
  }, [edit, result])

  // Draggable split between the editor region and the results grid. Default gives the
  // editor the larger share (results grid smaller by default); reset() restores this.
  //
  // `containerRef` + `reserve` are what keep this recoverable. The size is a persisted
  // px value, so a 600px editor restored into a 400px-tall panel (a short window, a
  // horizontally-split grid) used to consume the whole console: the results grid
  // collapsed to zero AND the divider — the only handle for resizing or resetting — was
  // pushed below the visible area, with no way back short of clearing localStorage.
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const split = usePaneResize({
    axis: 'y',
    initial: 300,
    min: 96,
    max: 600,
    storageKey: 'db.console.editorH',
    containerRef: splitContainerRef,
    // Divider + the results toolbar + a couple of rows: enough that the grid is still
    // recognisably a grid, and enough that the divider stays on screen.
    reserve: RESULTS_MIN_HEIGHT,
  })

  // The one Run action: the selection if any, else the single statement the cursor is ON.
  // If the caret isn't on a statement (a multi-statement buffer with the caret in a gap),
  // do NOTHING — silently, no error (a single-statement buffer always runs).
  // A script offers "Run all": pressing Run on a CREATE + INSERT script ran only the statement
  // under the caret, and nothing on screen said the rest had not run.
  const statementCount = useMemo(() => splitStatements(c.sql, dialect).length, [c.sql, dialect])
  const runAll = () => {
    rowEditing.setEditError(null)
    void c.runAll()
  }

  const runFocused = () => {
    const api = editor.editorApiRef.current
    const stmt = statementToRun(
      c.sql,
      api?.getSelectedText() ?? '',
      api?.getCursorOffset() ?? c.sql.length,
      dialect,
    )
    if (stmt) {
      rowEditing.setEditError(null)
      void c.runSql(stmt)
    }
  }

  // Run the query plan for the focused statement (plain EXPLAIN — never executes it),
  // rendering the plan rows in the same grid. Hidden on dialects without portable EXPLAIN.
  const explainFocused = () => {
    if (!dialect) return
    const api = editor.editorApiRef.current
    const stmt =
      statementToRun(
        c.sql,
        api?.getSelectedText() ?? '',
        api?.getCursorOffset() ?? c.sql.length,
        dialect,
      ) || c.sql
    const wrapped = explainQuery(stmt, dialect)
    if (wrapped) void c.runSql(wrapped)
  }

  return (
    <div ref={splitContainerRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="flex shrink-0 flex-col border-b border-border-soft"
        style={{ height: split.size, ...(split.resizing ? { transition: 'none' } : null) }}
      >
        <CodeEditor
          value={c.sql}
          language="sql"
          onChange={c.setSql}
          formatText={formatSql}
          onSubmit={runFocused}
          submitActionLabel="Run Selection or Statement"
          completionSource={completionSource}
          nextEditSource={nextEditSource}
          nextEdit={editor.nextEdits}
          onNextEdit={editor.setNextEdits}
          onEditorReady={editor.onEditorReady}
          extensions={editor.editorExtensions}
          className="min-h-0 flex-1"
        />
        <RunBar
          c={c}
          dialect={dialect}
          showTransactions={showTransactions}
          result={result}
          edit={edit}
          history={history}
          filterCount={filterCount}
          onClearFilters={onClearFilters}
          onBack={onBack}
          onRun={runFocused}
          statementCount={statementCount}
          onRunAll={runAll}
          problems={editor.problems}
          onRevealProblem={editor.revealFirstProblem}
          onExplain={explainFocused}
          onFormat={() => void editor.editorApiRef.current?.formatDocument()}
          onImportCsv={rowEditing.importCsv}
        />
      </div>
      {/* Draggable split — drag to resize editor vs results, double-click to reset. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize editor and results"
        aria-valuenow={Math.round(split.size)}
        aria-valuemin={split.min}
        aria-valuemax={Math.round(split.limit)}
        tabIndex={0}
        onPointerDown={split.onResizeStart}
        onKeyDown={split.onResizeKeyDown}
        onDoubleClick={split.reset}
        title="Drag or use arrow keys to resize · double-click to reset"
        className={cn(
          // Shared sash recipe: one hover tint + hover-intent delay (enter-only);
          // the mid-drag highlight bypasses the delay.
          'h-1 shrink-0 cursor-row-resize transition-colors hover:bg-foreground/15 hover:delay-200',
          'focus-visible:bg-foreground/25 focus-visible:outline-none',
          split.resizing ? 'bg-foreground/15 delay-0' : 'bg-transparent',
        )}
      />
      <ResultsArea
        c={c}
        editError={rowEditing.editError}
        onDismissEditError={() => rowEditing.setEditError(null)}
        linkColumns={linkColumns}
        onCellLink={onCellLink}
        onCellFilter={onCellFilter}
        onColumnFilter={onColumnFilter}
        pkColumns={pkColumns}
        edit={edit}
        editable={!!editable}
        editableColumns={edit?.editableColumnIds}
        onCommitChanges={editable ? rowEditing.commitChanges : undefined}
        connectionLabel={connectionLabel}
      />
      <QueryParametersDialog console={c} />
    </div>
  )
}
