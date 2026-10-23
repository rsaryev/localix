import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { FileTab, type EditorRunContext } from '@localixai/mini-app-sdk/ui/components'
import { activeResultFacet, outputFacet } from './model/consoleContext'
import { mergeMessageContext } from './model/mergeMessageContext'
import type { EditorPosition } from '@localixai/kit/code-editor'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { useSqlFileConnections } from './model/useSqlFileConnections'
import { useSchema } from './model/useSchema'
import { useSqlConsole } from './model/useSqlConsole'
import { offsetAt, sqlCompletions } from './model/sqlCompletion'
import { statementToRun, splitStatements } from '../shared/sql-statements'
import { explainQuery, supportsExplain } from './model/sqlExplain'
import { formatSql } from './model/formatSql'
import { SqlFilePanel } from './ui/SqlFilePanel'
import { useEditorIntegration } from './ui/sql-console/useEditorIntegration'
import { useSqlEditorModel } from './db-console-tab/useSqlEditorModel'
import { useSqlCatalog } from './model/sql-diagnostics/useSqlCatalog'
import { useEngineCheck } from './model/sql-diagnostics/useEngineCheck'
import { selectTableSql } from './model/sqlIdent'
import { sqlPredictionContextReferences } from './model/sqlPredictionContext'
import { useSqlHistory } from './model/useSqlHistory'
import { QueryParametersDialog } from './ui/QueryParametersDialog'

/**
 * A `.sql` file open in the code editor, upgraded into a first-class database
 * experience: the ordinary editable FileTab (save / dirty-diff / edit) PLUS
 * schema-aware SQL autocomplete bound to a live connection and a Run affordance
 * (⌘/Ctrl+Enter or the docked Run button) that executes the statement under the cursor
 * (or the selection) and renders results in the shared virtualized grid.
 *
 * Contributed via the open `fileEditors` registry (see `register.tsx`), so the core
 * editor grid routes `.sql` paths here without naming this mini app.
 */
export function SqlFileTab(props: React.ComponentProps<typeof FileTab>) {
  const { active, live, setActiveId } = useSqlFileConnections()
  // Two .sql files can run against one connection, so the FILE is half of the identity a failed
  // statement is filed under.
  const fileName = props.path.split('/').pop() || props.path
  const connectionId = active?.id ?? ''
  const schema = useSchema(connectionId)
  const history = useSqlHistory(connectionId)
  const sqlConsole = useSqlConsole(connectionId, {
    dialect: active?.dialect,
    dbLabel: active?.name,
    onExecuted: history.record,
  })

  // Schema-aware SQL completion (pure text→items) — the host injects the live buffer.
  // Works even with no connection: an empty schema still offers SQL keywords.
  const model = schema.model
  const auxCompletionSource = useCallback(
    (text: string, pos: EditorPosition) =>
      sqlCompletions(text, offsetAt(text, pos.line, pos.character), model),
    [model],
  )
  const predictionContextRevision = history.entries[0]?.at.toString() ?? 'empty'

  const nextEditContextSource = useCallback(
    (request: Parameters<typeof sqlPredictionContextReferences>[0]['request']) =>
      active
        ? sqlPredictionContextReferences({
            connectionId: active.id,
            connectionLabel: active.name,
            schemas: schema.schemas,
            request,
            contextRevision: predictionContextRevision,
          })
        : [],
    [active, predictionContextRevision, schema.schemas],
  )

  // Run the statement under the cursor (or the selection) against the active
  // connection. No-op when nothing is connected — the panel shows a hint instead.
  const doRun = useCallback(
    (ctx: EditorRunContext) => {
      if (!active) return
      const stmt = statementToRun(ctx.fullText, ctx.selectedText, ctx.cursorOffset, active.dialect)
      if (stmt) void sqlConsole.runSql(stmt)
    },
    [active, sqlConsole],
  )

  // The docked Run button reuses the same run path as ⌘/Ctrl+Enter via the editor's
  // run-context getter (bound once by FileTab).
  const getCtxRef = useRef<() => EditorRunContext>(null)
  const bindRunContext = useCallback((get: () => EditorRunContext) => {
    getCtxRef.current = get
  }, [])
  // The SAME editor integration the console mounts (statement highlight, ⌘-click table links,
  // column tint, live + engine + last-run diagnostics). This tab used to carry its own copy, and
  // the copy drifted: it never got the engine's compile check.
  const { tableNameSet, columnNameSet } = useSqlEditorModel(schema, sqlConsole.getText)
  const { catalog, onWantColumns } = useSqlCatalog(schema)
  const engineCheck = useEngineCheck(active?.id)
  const openTable = useCallback(
    (table: string) => {
      if (active) void sqlConsole.runSql(selectTableSql({ table, dialect: active.dialect }))
    },
    [active, sqlConsole],
  )
  const {
    editorExtensions: sqlEditorExtensions,
    problems,
    revealFirstProblem,
  } = useEditorIntegration({
    tableNames: tableNameSet,
    onOpenTable: openTable,
    columnNames: columnNameSet,
    catalog,
    dialect: active?.dialect,
    onWantColumns,
    runFailure: sqlConsole.lastFailure,
    engineCheck,
  })
  const runFromButton = useCallback(() => {
    const ctx = getCtxRef.current?.()
    if (ctx) doRun(ctx)
  }, [doRun])

  // Run the whole file as a script: every top-level statement in order, stopping at the
  // first failure (runSql resolves false). Reuses the console hook's run + error handling.
  const runFile = useCallback(async () => {
    const ctx = getCtxRef.current?.()
    if (!active || !ctx) return
    for (const stmt of splitStatements(ctx.fullText, active.dialect)) {
      if (!(await sqlConsole.runSql(stmt))) break
    }
  }, [active, sqlConsole])

  // Explain the focused statement's query plan (plain EXPLAIN — never executes it).
  const explainFromEditor = useCallback(() => {
    const ctx = getCtxRef.current?.()
    if (!active || !ctx) return
    const stmt =
      statementToRun(ctx.fullText, ctx.selectedText, ctx.cursorOffset, active.dialect) ||
      ctx.fullText
    const wrapped = explainQuery(stmt, active.dialect)
    if (wrapped) void sqlConsole.runSql(wrapped)
  }, [active, sqlConsole])

  // Format the whole file in place (same conservative pretty-printer as the console).
  const formatFromEditor = useCallback(() => {
    const ctx = getCtxRef.current?.()
    if (ctx) void ctx.formatDocument()
  }, [])

  const bottomPanel = useMemo(
    () => (
      <SqlFilePanel
        fileName={fileName}
        live={live}
        active={active}
        onSelectConnection={setActiveId}
        running={sqlConsole.running}
        outcome={sqlConsole.outcome}
        error={sqlConsole.error}
        errorCode={sqlConsole.errorCode}
        errorDetail={sqlConsole.errorDetail}
        rows={sqlConsole.sortedRows}
        sort={sqlConsole.sort}
        toggleSort={sqlConsole.toggleSort}
        filter={sqlConsole.filter}
        onFilterChange={sqlConsole.setFilter}
        totalRows={sqlConsole.totalRows}
        onRun={runFromButton}
        onRunFile={() => void runFile()}
        onExplain={active && supportsExplain(active.dialect) ? explainFromEditor : undefined}
        onFormat={formatFromEditor}
        onStop={sqlConsole.cancel}
        onOpenWorkbench={() => miniAppWorkspace.openSidebarSection('database')}
        problems={problems}
        onRevealProblem={revealFirstProblem}
      />
    ),
    [
      fileName,
      live,
      active,
      setActiveId,
      sqlConsole.running,
      sqlConsole.outcome,
      sqlConsole.error,
      sqlConsole.errorCode,
      sqlConsole.errorDetail,
      sqlConsole.cancel,
      sqlConsole.sortedRows,
      sqlConsole.sort,
      sqlConsole.toggleSort,
      sqlConsole.filter,
      sqlConsole.setFilter,
      sqlConsole.totalRows,
      runFromButton,
      runFile,
      explainFromEditor,
      formatFromEditor,
      problems,
      revealFirstProblem,
    ],
  )

  // The file view's publication (selection / dirty buffer) plus this runner's result and Output
  // facets, published as ONE — see `mergeMessageContext` for why two writers cannot share a slot.
  const [fileContext, setFileContext] = useState<PublishedMessageContext | null>(null)
  const resultContext = useMemo(
    () => activeResultFacet(sqlConsole.tabs, sqlConsole.activeTabId, active?.name),
    [sqlConsole.tabs, sqlConsole.activeTabId, active?.name],
  )
  const outputContext = useMemo(
    () => outputFacet(sqlConsole.tabs, active?.name),
    [sqlConsole.tabs, active?.name],
  )
  const { publishMessageContext } = props
  useEffect(() => {
    const facets = [resultContext, outputContext].filter((facet) => facet !== null)
    publishMessageContext?.(mergeMessageContext(fileContext, facets))
  }, [fileContext, outputContext, publishMessageContext, resultContext])

  return (
    <>
      <FileTab
        {...props}
        publishMessageContext={setFileContext}
        auxCompletionSource={auxCompletionSource}
        nextEditContextSource={nextEditContextSource}
        onRun={doRun}
        bindRunContext={bindRunContext}
        bottomPanel={bottomPanel}
        extensions={sqlEditorExtensions}
        formatText={formatSql}
      />
      <QueryParametersDialog console={sqlConsole} />
    </>
  )
}
