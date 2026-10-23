import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallowStable } from './useShallowStable'
import { acknowledgeInline, runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import type { DbErrorCode } from '../dbClient'
import { databaseApi, DbApiError } from '../api/databaseApi'
import { adaptResult } from './resultAdapter'
import { splitStatements } from '../../shared/sql-statements'
import { isSchemaChangingStatement } from '../../shared/schema-change'
import { schemaStore } from './schemaStore'
import { activeTab as selectActiveTab } from './resultTabs'
import { compileRunStatement } from './sql-console/compileRun'
import { recordNonRowResult, recordRowResult, recordRunError } from './sql-console/recordRun'
import { useEditorDraft } from './sql-console/useEditorDraft'
import { useResultTabsState } from './sql-console/useResultTabsState'
import { useTxController } from './sql-console/useTxController'
import type { RunMeta, SqlConsoleState, UseSqlConsoleOptions } from './sql-console/types'
import type { SqlRunFailure } from './sql-diagnostics/run-error'
import { describeParams, type ParamField } from './sqlParams'
import { DATABASE_DATA } from './topics'
import { withLiveConnection } from './withLiveConnection'

export type { SqlConsoleState, UseSqlConsoleOptions } from './sql-console/types'

interface PendingParameterRun {
  sql: string
  meta?: RunMeta
  resolve: (ran: boolean) => void
}

interface ActiveRun {
  token: symbol
  connectionId: string
}

export function useSqlConsole(
  connectionId: string,
  options: UseSqlConsoleOptions = {},
): SqlConsoleState {
  const { sql, setSql, sqlRef } = useEditorDraft(options.draftKey)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const paramValuesRef = useRef(paramValues)
  const [parameterPrompt, setParameterPrompt] = useState<{
    sql: string
    fields: ParamField[]
  } | null>(null)
  const pendingParameterRunRef = useRef<PendingParameterRun | null>(null)
  useEffect(() => {
    paramValuesRef.current = paramValues
  }, [paramValues])
  const setParam = useCallback((key: string, value: string) => {
    setParamValues((prev) => {
      const next = { ...prev, [key]: value }
      // Keep the submit callback correct even when an input change and Enter happen in
      // the same browser event turn, before React's effect mirrors the new state.
      paramValuesRef.current = next
      return next
    })
  }, [])
  const dialect = options.dialect
  const [errorCode, setErrorCode] = useState<DbErrorCode | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [lastFailure, setLastFailure] = useState<SqlRunFailure | null>(null)
  // Read the db prefix through a ref so `execute` stays stable while the label can change
  // (e.g. the .sql-file runner switching active connection).
  const dbLabelRef = useRef(options.dbLabel)
  useEffect(() => {
    dbLabelRef.current = options.dbLabel
  }, [options.dbLabel])
  const tabs = useResultTabsState()
  const { resetTabs, setTabsState, tabsStateRef } = tabs
  const tx = useTxController(connectionId, setError, setErrorCode)
  const { ensureTxBeforeStatement } = tx
  // Mirror latest running into a ref (in an effect, not render) so the stable
  // `run`/`execute` callbacks read fresh values without a stale closure.
  const runningRef = useRef(running)
  const activeRunRef = useRef<ActiveRun | null>(null)
  const previousConnectionRef = useRef(connectionId)
  const onExecutedRef = useRef(options.onExecuted)
  useEffect(() => {
    runningRef.current = running
  }, [running])
  useEffect(() => {
    onExecutedRef.current = options.onExecuted
  }, [options.onExecuted])

  // A .sql file can switch its live connection without remounting this hook. Everything
  // below the editor is connection-scoped: old results/parameters must not appear under
  // the new label, and an old request must keep its own cancel target and lose permission
  // to publish if its response arrives after the switch.
  useEffect(() => {
    const previousConnectionId = previousConnectionRef.current
    if (previousConnectionId === connectionId) return
    previousConnectionRef.current = connectionId

    const pending = pendingParameterRunRef.current
    pendingParameterRunRef.current = null
    pending?.resolve(false)
    setParameterPrompt(null)
    setParamValues({})
    paramValuesRef.current = {}
    setError(null)
    setErrorCode(null)
    setErrorDetail(null)
    setLastFailure(null)
    resetTabs()

    const activeRun = activeRunRef.current
    if (activeRun?.connectionId === previousConnectionId) {
      activeRunRef.current = null
      runningRef.current = false
      setRunning(false)
      void databaseApi.cancel(previousConnectionId).catch(() => {})
    }
  }, [connectionId, resetTabs])

  const executeBound = useCallback(
    async (text: string, meta?: RunMeta): Promise<boolean> => {
      const trimmed = text.trim()
      if (!trimmed || runningRef.current) return false
      const token = Symbol('database-query-run')
      const ownsRun = () => activeRunRef.current?.token === token
      // Mutate the ref synchronously (not just via the render effect) so a sequential
      // "Run all" loop sees the busy flag between awaits and never bails a statement.
      activeRunRef.current = { token, connectionId }
      runningRef.current = true
      setRunning(true)
      setError(null)
      setErrorCode(null)
      setErrorDetail(null)
      setLastFailure(null)
      if (!(await ensureTxBeforeStatement())) {
        if (ownsRun()) {
          activeRunRef.current = null
          runningRef.current = false
          setRunning(false)
        }
        return false
      }
      if (!ownsRun()) return false
      const { text: runSqlText, params } = compileRunStatement(
        trimmed,
        dialect,
        paramValuesRef.current,
      )
      try {
        const result = await withLiveConnection(connectionId, () =>
          databaseApi.query(connectionId, runSqlText, params),
        )
        if (!ownsRun()) return false
        const ctx = {
          at: Date.now(),
          db: dbLabelRef.current,
          sql: trimmed,
          durationMs: result.durationMs,
        }
        if (result.columns.length > 0) {
          const adapted = adaptResult(result)
          setTabsState((s) => recordRowResult(s, ctx, adapted, meta))
        } else {
          setTabsState((s) => recordNonRowResult(s, ctx, result.rowsAffected ?? 0))
          // No rows back: a write or DDL, whose rows an open table page may be showing.
          DATABASE_DATA.invalidate(connectionId)
        }
        onExecutedRef.current?.(trimmed)
        // A DDL (CREATE/DROP/ALTER/RENAME) changed the schema shape — refresh the shared
        // schema tree so a new/dropped table shows without a manual reload. Cheap: only on
        // DDL, never on SELECT/INSERT/UPDATE/DELETE.
        if (isSchemaChangingStatement(trimmed)) schemaStore.reload(connectionId)
        return true
      } catch (e) {
        if (!ownsRun()) return false
        const message = e instanceof Error ? e.message : 'Query failed'
        const code = e instanceof DbApiError ? (e.code ?? null) : null
        const detail = e instanceof DbApiError ? (e.detail ?? undefined) : undefined
        acknowledgeInline(e)
        setError(message)
        setErrorCode(code)
        setErrorDetail(detail ?? null)
        // The engine's own text names the offender; the friendly sentence does not.
        setLastFailure({ sql: trimmed, message: detail ?? message })
        setTabsState((s) =>
          recordRunError(
            s,
            { at: Date.now(), db: dbLabelRef.current, sql: trimmed, durationMs: 0 },
            message,
            detail,
            code,
          ),
        )
        return false
      } finally {
        if (ownsRun()) {
          activeRunRef.current = null
          runningRef.current = false
          setRunning(false)
        }
      }
    },
    [connectionId, dialect, ensureTxBeforeStatement, setTabsState],
  )

  /**
   * Gate a parameterized run behind confirmation. The Promise stays pending while the
   * dialog is open, which also makes "Run all" pause correctly before each parameterized
   * statement instead of racing ahead.
   */
  const execute = useCallback(
    (text: string, meta?: RunMeta): Promise<boolean> => {
      const trimmed = text.trim()
      if (!trimmed || runningRef.current || pendingParameterRunRef.current)
        return Promise.resolve(false)
      const descriptor = dialect ? describeParams(trimmed, dialect) : null
      if (!descriptor?.any) return executeBound(trimmed, meta)

      return new Promise<boolean>((resolve) => {
        pendingParameterRunRef.current = { sql: trimmed, meta, resolve }
        setParameterPrompt({ sql: trimmed, fields: descriptor.fields })
      })
    },
    [dialect, executeBound],
  )

  const cancelParameters = useCallback(() => {
    const pending = pendingParameterRunRef.current
    pendingParameterRunRef.current = null
    setParameterPrompt(null)
    pending?.resolve(false)
  }, [])

  const submitParameters = useCallback(async () => {
    const pending = pendingParameterRunRef.current
    if (!pending) return
    pendingParameterRunRef.current = null
    setParameterPrompt(null)
    pending.resolve(await executeBound(pending.sql, pending.meta))
  }, [executeBound])

  // A caller may be awaiting runSql/runAll when its console tab unmounts. Resolve that
  // request as cancelled so no orphaned Promise survives the tab.
  useEffect(
    () => () => {
      pendingParameterRunRef.current?.resolve(false)
      pendingParameterRunRef.current = null
      const activeRun = activeRunRef.current
      activeRunRef.current = null
      runningRef.current = false
      if (activeRun) void databaseApi.cancel(activeRun.connectionId).catch(() => {})
    },
    [],
  )

  // Fire-and-forget: the server aborts the in-flight statement, which makes the pending
  // query() reject with a typed `cancelled` error handled in executeBound()'s catch. A refused
  // cancel is reported, because the statement is then STILL running and the click looked dead.
  const cancel = useCallback(() => {
    const activeRun = activeRunRef.current
    if (!activeRun) return
    runMiniAppAction(() => databaseApi.cancel(activeRun.connectionId), 'Could not cancel the query')
  }, [])

  const run = useCallback(() => execute(sqlRef.current), [execute, sqlRef])
  const runSql = useCallback((text: string, meta?: RunMeta) => execute(text, meta), [execute])
  // Execute-script: run every top-level statement in the editor in order, stopping at the
  // first failure (its error stays in the Output log). Each statement gets its own tab.
  const runAll = useCallback(async () => {
    for (const stmt of splitStatements(sqlRef.current, dialect)) {
      if (!(await execute(stmt))) break
    }
  }, [dialect, execute, sqlRef])
  const getText = useCallback(() => sqlRef.current, [sqlRef])
  const runText = useCallback(
    async (text: string, meta?: RunMeta): Promise<void> => {
      // Only overwrite the editor when the caller wants it (default true). The SQL console
      // passes replaceEditor:false for open-table / drill so it never wipes an in-progress
      // query — the result opens in its own tab instead.
      if (meta?.replaceEditor !== false) setSql(text)
      await execute(text, meta)
    },
    [execute, setSql],
  )

  // Re-run the active tab's own SQL (with its browse/filters) so it refreshes in place —
  // e.g. after a Commit. Reads the freshest tab from the ref to avoid a stale closure.
  const refreshActive = useCallback(async () => {
    const cur = selectActiveTab(tabsStateRef.current)
    if (cur?.kind !== 'result' || !cur.sql) return
    await execute(cur.sql, {
      asTable: !!cur.browse && (cur.filters?.length ?? 0) === 0,
      browse: cur.browse,
      filters: cur.filters,
      label: cur.label,
    })
  }, [execute, tabsStateRef])

  // One object per real change (see `useShallowStable`): a fresh literal every render invalidated
  // every `useCallback` a console tab keyed on it — open table, insert column, row-edit gating,
  // drill navigation — so each keystroke rebuilt them all and re-rendered what they fed.
  return useShallowStable({
    connectionId,
    sql,
    setSql,
    running,
    error,
    errorCode,
    errorDetail,
    lastFailure,
    cancel,
    outcome: tabs.outcome,
    sortedRows: tabs.sortedRows,
    sort: tabs.sort,
    toggleSort: tabs.toggleSort,
    filter: tabs.filter,
    setFilter: tabs.setFilter,
    totalRows: tabs.totalRows,
    run,
    runSql,
    runAll,
    runText,
    getText,
    paramValues,
    setParam,
    parameterPrompt,
    submitParameters,
    cancelParameters,
    patchResultRows: tabs.patchResultRows,
    tabs: tabs.tabsState.tabs,
    activeTabId: tabs.tabsState.activeId,
    active: tabs.active,
    activateTab: tabs.activateTab,
    closeTab: tabs.closeTab,
    clearOutput: tabs.clearOutput,
    refreshActive,
    txMode: tx.txMode,
    setTxMode: tx.setTxMode,
    txOpen: tx.txOpen,
    txBusy: tx.txBusy,
    txNotice: tx.txNotice,
    commitTx: tx.commitTx,
    rollbackTx: tx.rollbackTx,
  })
}
