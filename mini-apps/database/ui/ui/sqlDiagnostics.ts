/**
 * What is wrong with the SQL in this editor, drawn as markers — from two sources:
 *
 *  - LIVE checks while typing: a table, column or alias the connected database does not have
 *    (`model/sql-diagnostics/diagnose.ts`);
 *  - the LAST RUN's failure: the name the engine's own error blamed, underlined in the statement
 *    that failed (`model/sql-diagnostics/run-error.ts`) — what the live checks cannot know, such
 *    as a permission, a type or a syntax error.
 *
 * Each source has its own marker OWNER, and neither uses the editor's `diagnostics` prop: in a
 * `.sql` file that prop carries the host's language-server findings, and a second writer to it
 * would erase them on every keystroke. Owners render side by side in one Problems list, and a
 * run failure is dropped the moment its statement is edited without touching the live checks.
 *
 * The live checks re-run on an edit (debounced) and on `refresh()`, which the host calls when the
 * schema moves or a run finishes — a table's columns arriving is exactly when a stood-down check
 * can finally speak.
 */
import type { MonacoEditorExtension } from '@localixai/kit/code-editor'
import type { DbDialect } from '../../shared/driver-catalog'
import type { SqlCatalog } from '../model/sql-diagnostics/catalog'
import { diagnoseSql } from '../model/sql-diagnostics/diagnose'
import { locateRunError, type SqlRunFailure } from '../model/sql-diagnostics/run-error'
import type { EngineProblemRange } from '../model/sql-diagnostics/engine-check'

const LIVE_OWNER = 'localix-sql'
const RUN_OWNER = 'localix-sql-run'
const ENGINE_OWNER = 'localix-sql-engine'
const OWNERS = [LIVE_OWNER, RUN_OWNER, ENGINE_OWNER]
const DEBOUNCE_MS = 250
/** The engine check is a round trip: wait for a pause in typing, not every keystroke. */
const ENGINE_DEBOUNCE_MS = 700
/** Past this, a buffer is a dump being viewed, not a query being written. */
const MAX_ANALYZED_CHARS = 200_000

export interface SqlDiagnosticsInput {
  getCatalog: () => SqlCatalog | null
  getDialect: () => DbDialect | undefined
  /** Columns a check needed — load them; the host's `refresh()` then re-runs the check. */
  onWantColumns: (tables: Array<{ name: string; schema: string }>) => void
  /** The statement that failed last, if any (the console's `lastFailure`). */
  getRunFailure?: () => SqlRunFailure | null
  /**
   * Ask the connected engine to COMPILE the text without running it — what the live name checks
   * cannot see (a syntax error, a type mismatch). Absent when the engine cannot check side-effect
   * free. Ranges are offsets into the text that was checked.
   */
  getEngineCheck?: () => ((sql: string) => Promise<SqlEngineProblem[]>) | null
  /** Every owner's markers summed after each re-draw — the run bar's "N problems". */
  onProblems?: (summary: SqlProblemSummary) => void
}

export type SqlEngineProblem = EngineProblemRange

export interface SqlProblemSummary {
  errors: number
  warnings: number
  /** The first problem in document order, for the run bar's one-line reason. */
  first: { message: string; line: number } | null
  /** An engine check is in flight for the current text. */
  checking: boolean
}

export const NO_PROBLEMS: SqlProblemSummary = {
  errors: 0,
  warnings: 0,
  first: null,
  checking: false,
}

type MarkerContext = Parameters<MonacoEditorExtension['setup']>[0]
type MarkerData = Parameters<MarkerContext['monaco']['editor']['setModelMarkers']>[2][number]

function marker(
  { monaco, model }: MarkerContext,
  range: { start: number; end: number; message: string },
  severity: 'error' | 'warning',
  source: string,
  code?: string,
): MarkerData {
  const start = model.getPositionAt(range.start)
  const end = model.getPositionAt(range.end)
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    severity: severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: range.message,
    source,
    ...(code ? { code } : {}),
  }
}

export function createSqlDiagnostics(input: SqlDiagnosticsInput): {
  extension: MonacoEditorExtension
  refresh: () => void
  /** Move the caret to the first problem and reveal it (the run bar's click). */
  revealFirst: () => void
} {
  const renders = new Set<() => void>()
  const reveals = new Set<() => void>()
  const extension: MonacoEditorExtension = {
    setup(context) {
      const { monaco, editor, model } = context
      let timer: ReturnType<typeof setTimeout> | undefined
      let engineTimer: ReturnType<typeof setTimeout> | undefined
      // Each engine check is stamped; a slower answer for text the user has since edited must
      // not paint over the current one.
      let engineSeq = 0
      let checking = false
      const ownMarkers = () =>
        monaco.editor
          .getModelMarkers({ resource: model.uri })
          .filter((m) => OWNERS.includes(m.owner))
          .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
      const summarize = () => {
        if (!input.onProblems || model.isDisposed()) return
        const markers = ownMarkers()
        const first = markers[0]
        input.onProblems({
          errors: markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length,
          warnings: markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length,
          first: first ? { message: first.message, line: first.startLineNumber } : null,
          checking,
        })
      }
      const renderEngine = async () => {
        const check = input.getEngineCheck?.() ?? null
        const sql = model.getValue()
        const seq = ++engineSeq
        if (!check || !sql.trim() || sql.length > MAX_ANALYZED_CHARS) {
          monaco.editor.setModelMarkers(model, ENGINE_OWNER, [])
          summarize()
          return
        }
        checking = true
        summarize()
        const problems = await check(sql).catch(() => [])
        if (seq !== engineSeq || model.isDisposed()) return
        checking = false
        monaco.editor.setModelMarkers(
          model,
          ENGINE_OWNER,
          problems.map((p) => marker(context, p, 'error', 'Database')),
        )
        summarize()
      }
      const scheduleEngine = () => {
        clearTimeout(engineTimer)
        engineTimer = setTimeout(() => void renderEngine(), ENGINE_DEBOUNCE_MS)
      }
      const renderLive = () => {
        const dialect = input.getDialect()
        const sql = model.getValue()
        if (!dialect || sql.length > MAX_ANALYZED_CHARS) {
          monaco.editor.setModelMarkers(model, LIVE_OWNER, [])
          return
        }
        const result = diagnoseSql(sql, dialect, input.getCatalog())
        if (result.wantColumns.length) input.onWantColumns(result.wantColumns)
        monaco.editor.setModelMarkers(
          model,
          LIVE_OWNER,
          result.diagnostics.map((d) => marker(context, d, d.severity, 'SQL', d.code)),
        )
        summarize()
      }
      // Cheap (one search of the buffer), so it runs on every edit: a stale underline on text the
      // user already fixed would read as "still broken".
      const renderRun = () => {
        const failure = input.getRunFailure?.() ?? null
        const dialect = input.getDialect()
        const cursor = editor.getPosition?.()
        const near = cursor ? model.getOffsetAt(cursor) : 0
        const range =
          failure && dialect ? locateRunError(model.getValue(), failure, dialect, near) : null
        monaco.editor.setModelMarkers(
          model,
          RUN_OWNER,
          range ? [marker(context, range, 'error', 'Database')] : [],
        )
        summarize()
      }
      const scheduleLive = () => {
        clearTimeout(timer)
        timer = setTimeout(renderLive, DEBOUNCE_MS)
      }
      const refresh = () => {
        renderRun()
        scheduleLive()
        scheduleEngine()
      }
      const reveal = () => {
        const first = ownMarkers()[0]
        if (!first) return
        const position = { lineNumber: first.startLineNumber, column: first.startColumn }
        editor.setPosition(position)
        editor.revealPositionInCenterIfOutsideViewport(position)
        editor.focus()
      }
      renders.add(refresh)
      reveals.add(reveal)
      const content = model.onDidChangeContent(refresh)
      renderLive()
      renderRun()
      scheduleEngine()
      return {
        dispose() {
          clearTimeout(timer)
          clearTimeout(engineTimer)
          engineSeq++
          renders.delete(refresh)
          reveals.delete(reveal)
          content.dispose()
          if (model.isDisposed()) return
          for (const owner of OWNERS) monaco.editor.setModelMarkers(model, owner, [])
        },
      }
    },
  }
  return {
    extension,
    refresh: () => {
      for (const render of renders) render()
    },
    revealFirst: () => {
      for (const reveal of reveals) reveal()
    },
  }
}
