/** CodeEditor integration for the SQL console: the ready-API ref, the ephemeral AI
 *  next-edit hunks, and the mount-only editor extensions (statement highlight,
 *  ⌘/Ctrl-click table links, column tint) fed through latest boxes. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorSuggestion } from '@localixai/kit/code-editor'
import type { DbDialect } from '../../../shared/driver-catalog'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import type { SqlCatalog } from '../../model/sql-diagnostics/catalog'
import type { SqlRunFailure } from '../../model/sql-diagnostics/run-error'
import {
  createSqlDiagnostics,
  NO_PROBLEMS,
  type SqlEngineProblem,
  type SqlProblemSummary,
} from '../sqlDiagnostics'
import { sqlStatementHighlight } from '../sqlStatementHighlight'
import { sqlTableLinks } from '../sqlTableLinks'
import { sqlColumnHighlight } from '../sqlColumnHighlight'

const EMPTY_TABLE_SET: ReadonlySet<string> = new Set()

/** The slice of the CodeEditor ready-API this console uses (structural subset). */
export type EditorApi = {
  getSelectedText: () => string
  getCursorOffset: () => number
  formatDocument: () => Promise<void>
  acceptNextEdit: (hunk?: EditorSuggestion) => void
}

export function useEditorIntegration(opts: {
  tableNames?: ReadonlySet<string>
  onOpenTable?: (table: string) => void
  columnNames?: ReadonlySet<string>
  /** What the live diagnostics check names against; absent = no diagnostics. */
  catalog?: SqlCatalog | null
  dialect?: DbDialect
  onWantColumns?: (tables: Array<{ name: string; schema: string }>) => void
  /** The statement that failed last — underlined where the engine's error points. */
  runFailure?: SqlRunFailure | null
  /** Compile-without-running check by the connected engine; absent = live name checks only. */
  engineCheck?: ((sql: string) => Promise<SqlEngineProblem[]>) | null
}) {
  const {
    tableNames,
    onOpenTable,
    columnNames,
    catalog,
    dialect,
    onWantColumns,
    runFailure,
    engineCheck,
  } = opts
  const [problems, setProblems] = useState<SqlProblemSummary>(NO_PROBLEMS)
  const editorApiRef = useRef<EditorApi | null>(null)
  const onEditorReady = (api: EditorApi) => {
    editorApiRef.current = api
  }
  // Ephemeral AI edit-prediction hunks for the query buffer — rendered through the
  // SAME inline mini-diff decoration as review suggestions, one per hunk. Apply
  // routes THAT hunk to the editor's acceptNextEdit (Tab cascades the same way);
  // Reject drops just that hunk.
  const [nextEdits, setNextEdits] = useState<EditorSuggestion[] | null>(null)
  const onApplyNextEdit = (id: string) => {
    if (!id.startsWith('next-edit')) return
    const hunk = nextEdits?.find((s) => s.id === id)
    editorApiRef.current?.acceptNextEdit(hunk)
  }
  const onRejectNextEdit = (id: string) => {
    if (!id.startsWith('next-edit')) return
    setNextEdits((prev) => {
      const rest = (prev ?? []).filter((s) => s.id !== id)
      return rest.length > 0 ? rest : null
    })
  }
  // Latest boxes so the mount-only editor extensions read the current table set + handler at
  // interaction time (after commit). Each box is updated in a layout effect, never during render.
  const tableNamesLatest = useLatest(tableNames)
  const onOpenTableLatest = useLatest(onOpenTable)
  const columnNamesLatest = useLatest(columnNames)
  const catalogLatest = useLatest(catalog)
  const dialectLatest = useLatest(dialect)
  const onWantColumnsLatest = useLatest(onWantColumns)
  const runFailureLatest = useLatest(runFailure)
  const engineCheckLatest = useLatest(engineCheck)
  const diagnostics = useMemo(
    () =>
      createSqlDiagnostics({
        getCatalog: () => catalogLatest.current ?? null,
        getDialect: () => dialectLatest.current,
        onWantColumns: (tables) => onWantColumnsLatest.current?.(tables),
        getRunFailure: () => runFailureLatest.current ?? null,
        getEngineCheck: () => engineCheckLatest.current ?? null,
        // Summaries repeat on every keystroke; keep the old object when nothing changed, so
        // the run bar does not re-render per key.
        onProblems: (next) =>
          setProblems((prev) =>
            prev.errors === next.errors &&
            prev.warnings === next.warnings &&
            prev.checking === next.checking &&
            prev.first?.message === next.first?.message &&
            prev.first?.line === next.first?.line
              ? prev
              : next,
          ),
      }),
    [catalogLatest, dialectLatest, onWantColumnsLatest, runFailureLatest, engineCheckLatest],
  )
  // A new catalog is the schema moving (a table's columns arrived, a reload), a new failure is a
  // run finishing, a new engine check is a connection switch: either way, re-draw.
  useEffect(() => diagnostics.refresh(), [catalog, dialect, runFailure, engineCheck, diagnostics])
  // Editor extensions — stable across renders so the mount-only CodeEditor slot never churns:
  // the active-statement highlight + ⌘/Ctrl-click table links (read live through the latest
  // boxes: these closures only run on editor interaction, never during render).
  const editorExtensions = useMemo(
    () => [
      sqlStatementHighlight(),
      sqlTableLinks(
        () => tableNamesLatest.current ?? EMPTY_TABLE_SET,
        (t) => onOpenTableLatest.current?.(t),
      ),
      sqlColumnHighlight(() => columnNamesLatest.current ?? EMPTY_TABLE_SET),
      diagnostics.extension,
    ],
    [diagnostics, tableNamesLatest, onOpenTableLatest, columnNamesLatest],
  )
  return {
    editorApiRef,
    onEditorReady,
    nextEdits,
    setNextEdits,
    onApplyNextEdit,
    onRejectNextEdit,
    editorExtensions,
    problems,
    revealFirstProblem: diagnostics.revealFirst,
  }
}
