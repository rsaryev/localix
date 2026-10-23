import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sortRows, filterRows, type SortSpec } from '@localixai/dataview'
import type { AdaptedResult } from '../resultAdapter'
import {
  activeTab as selectActiveTab,
  activateTab as activateTabOp,
  clearOutput as clearOutputOp,
  closeTab as closeTabOp,
  emptyResultTabsState,
  type ResultOutcome,
  type ResultTab,
  type ResultTabsState,
} from '../resultTabs'

/** Apply `fn` to the ACTIVE result tab (no-op when none / the Output tab is active). */
function mapActiveResult(s: ResultTabsState, fn: (tab: ResultTab) => ResultTab): ResultTabsState {
  const cur = selectActiveTab(s)
  if (cur?.kind !== 'result') return s
  return { ...s, tabs: s.tabs.map((t) => (t.id === cur.id ? fn(t) : t)) }
}

/**
 * The result-tabs half of the SQL console: the tabs state (each executed SELECT / opened
 * table its own tab; non-row outcomes + errors in a singleton Output log), the active-tab
 * derivations (outcome / sort / filter / sortedRows), and the tab controls.
 */
export function useResultTabsState() {
  // Result tabs replace the old single `outcome` — each run opens/reuses a tab.
  const [tabsState, setTabsState] = useState<ResultTabsState>(() => emptyResultTabsState())
  const tabsStateRef = useRef(tabsState)
  useEffect(() => {
    tabsStateRef.current = tabsState
  }, [tabsState])

  // --- Result tabs controls ---
  const activateTab = useCallback((id: string) => setTabsState((s) => activateTabOp(s, id)), [])
  const closeTab = useCallback((id: string) => setTabsState((s) => closeTabOp(s, id)), [])
  const clearOutput = useCallback(() => setTabsState((s) => clearOutputOp(s)), [])
  const resetTabs = useCallback(() => {
    const empty = emptyResultTabsState()
    // Keep imperative readers (refreshActive) aligned in the same turn as a connection
    // boundary instead of waiting for the state-mirroring effect.
    tabsStateRef.current = empty
    setTabsState(empty)
  }, [])
  const active = useMemo(() => selectActiveTab(tabsState), [tabsState])

  // The active tab's outcome. For an Output tab (no grid), synthesize the last non-row
  // outcome so single-result consumers WITHOUT a tab strip (the `.sql`-file runner) still
  // show "N rows affected"; the console ignores this when the Output tab is active.
  const outcome: ResultOutcome | null = useMemo(() => {
    if (!active) return null
    if (active.kind === 'result') return active.outcome ?? null
    const last = active.log?.[active.log.length - 1]
    return last?.status === 'ok'
      ? {
          result: null,
          rowsAffected: last.rowsAffected,
          ddl: last.kind === 'ddl',
          durationMs: last.durationMs,
        }
      : null
  }, [active])
  const sort = active?.sort
  const filter = active?.filter ?? ''

  // Client-side result filter: a substring match across all columns of the active tab's
  // result, applied AFTER sort so row indices stay consistent for the editing paths.
  const sortedRows = useMemo(() => {
    if (!outcome?.result) return []
    const sorted = sortRows(outcome.result.rows, sort, outcome.result.columns)
    return filterRows(sorted, { query: filter })
  }, [outcome, sort, filter])
  /** Row count before the client-side filter (for a "N of M" status). */
  const totalRows = outcome?.result?.rows.length ?? 0

  const setFilter = useCallback((query: string) => {
    setTabsState((s) => mapActiveResult(s, (t) => ({ ...t, filter: query })))
  }, [])

  const toggleSort = useCallback((columnId: string) => {
    setTabsState((s) =>
      mapActiveResult(s, (t) => {
        const nextSort: SortSpec | undefined =
          t.sort?.columnId === columnId
            ? t.sort.dir === 'asc'
              ? { columnId, dir: 'desc' }
              : undefined
            : { columnId, dir: 'asc' }
        return { ...t, sort: nextSort }
      }),
    )
  }, [])

  const patchResultRows = useCallback(
    (updater: (rows: AdaptedResult['rows']) => AdaptedResult['rows']): (() => void) => {
      let prev: ResultTab['outcome'] | undefined
      let prevId: string | null = null
      setTabsState((s) => {
        const cur = selectActiveTab(s)
        if (cur?.kind !== 'result' || !cur.outcome?.result) return s
        prev = cur.outcome
        prevId = cur.id
        return {
          ...s,
          tabs: s.tabs.map((t) =>
            t.id === cur.id
              ? {
                  ...t,
                  outcome: {
                    ...t.outcome!,
                    result: { ...t.outcome!.result!, rows: updater(t.outcome!.result!.rows) },
                  },
                }
              : t,
          ),
        }
      })
      return () =>
        setTabsState((s) =>
          prevId
            ? { ...s, tabs: s.tabs.map((t) => (t.id === prevId ? { ...t, outcome: prev } : t)) }
            : s,
        )
    },
    [],
  )

  return {
    tabsState,
    setTabsState,
    tabsStateRef,
    activateTab,
    closeTab,
    clearOutput,
    resetTabs,
    active,
    outcome,
    sort,
    filter,
    setFilter,
    sortedRows,
    totalRows,
    toggleSort,
    patchResultRows,
  }
}
