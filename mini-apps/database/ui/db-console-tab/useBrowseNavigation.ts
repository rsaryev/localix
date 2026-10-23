import { useCallback, useState } from 'react'
import type { DbDialect } from '../dbClient'
import type { SqlConsoleState } from '../model/useSqlConsole'
import { quoteIdent, selectTableSql } from '../model/sqlIdent'
import { sqlLiteral } from '../model/sqlLiteral'
import { qualifiedTable } from '../model/rowMutations'
import type { BrowseTarget } from './useRowEditGate'

/**
 * Drill/filter navigation for the console's browsed table: FK-cell jumps, stacked WHERE
 * predicates (cell + header funnels), clear-filters, and the Back stack. The stack is
 * kept here (not on a tab) because it is navigation history across runs, not a property
 * of any one result.
 */
export function useBrowseNavigation({
  consoleState,
  dialect,
  browse,
  browseFilters,
  activeSql,
  active,
  fkLinks,
}: {
  consoleState: SqlConsoleState
  dialect: DbDialect
  browse: BrowseTarget | null
  browseFilters: string[]
  activeSql: string
  active: SqlConsoleState['active']
  fkLinks: Map<string, { refSchema?: string; refTable: string; refColumn: string }> | undefined
}) {
  // Drill-back stack: each FK jump / filter pushes the state to return to (the query text +
  // browse target + active filters), so "Back" restores it fully.
  const [backStack, setBackStack] = useState<
    Array<{ sql: string; browse: BrowseTarget | null; filters: string[] }>
  >([])

  /** Reset the stack (opening a table from the tree is a fresh navigation context). */
  const resetBackStack = useCallback(() => setBackStack([]), [])

  // Snapshot the active result tab (what a drill/filter should return to via Back).
  const snapshot = useCallback(
    () => ({ sql: activeSql, browse, filters: browseFilters }),
    [activeSql, browse, browseFilters],
  )

  const onCellLink = useCallback(
    (columnId: string, value: unknown) => {
      const ref = fkLinks?.get(columnId)
      if (!ref) return
      // The FK target is normally a primary key (one row), so no LIMIT is needed — this
      // also sidesteps dialect LIMIT/TOP-vs-WHERE ordering.
      const target = qualifiedTable({ table: ref.refTable, schema: ref.refSchema, dialect })
      const sql = `SELECT * FROM ${target} WHERE ${quoteIdent(ref.refColumn, dialect)} = ${sqlLiteral(value, dialect)}`
      setBackStack((s) => [...s, snapshot()]) // remember where we came from
      // A filtered lookup is a read view, not the browsed table — keyed by SQL, no browse.
      void consoleState.runText(sql, { browse: null, filters: [], replaceEditor: false })
    },
    [fkLinks, dialect, consoleState, snapshot],
  )

  // The active result columns' title = the DB column name (used by both funnels below).
  const columnTitle = useCallback(
    (columnId: string) =>
      (active?.outcome?.result?.columns ?? []).find((c) => c.id === columnId)?.title,
    [active],
  )

  // Stack one more WHERE predicate onto the browsed table (p1 AND p2 …) and re-run its
  // SELECT. Keeps browsing the table so more funnels can stack; Back pops the last one.
  const pushFilter = useCallback(
    (pred: string) => {
      if (!browse) return
      const next = [...browseFilters, pred]
      const sql = `SELECT * FROM ${qualifiedTable({ ...browse, dialect })} WHERE ${next.join(' AND ')}`
      setBackStack((s) => [...s, snapshot()])
      void consoleState.runText(sql, { browse, filters: next, replaceEditor: false })
    },
    [browse, browseFilters, dialect, consoleState, snapshot],
  )

  // Filter the browsed table by a cell's value: `col = value` (or `col IS NULL`).
  const onCellFilter = useCallback(
    (columnId: string, value: unknown) => {
      const title = columnTitle(columnId)
      if (!title) return
      const col = quoteIdent(title, dialect)
      pushFilter(
        value === null || value === undefined
          ? `${col} IS NULL`
          : `${col} = ${sqlLiteral(value, dialect)}`,
      )
    },
    [columnTitle, dialect, pushFilter],
  )

  // Per-column header funnel: a typed substring filter (`col LIKE %value%`). Reuses the
  // SAME server-side WHERE-predicate stack as the cell funnel — no parallel filter system.
  const onColumnFilter = useCallback(
    (columnId: string, value: string) => {
      const title = columnTitle(columnId)
      if (!title) return
      pushFilter(`${quoteIdent(title, dialect)} LIKE ${sqlLiteral(`%${value}%`, dialect)}`)
    },
    [columnTitle, dialect, pushFilter],
  )

  // Clear all active filters at once: back to the browsed table's plain SELECT (reuses
  // the table's own tab).
  const onClearFilters = useCallback(() => {
    if (!browse) return
    setBackStack((s) => [...s, snapshot()])
    void consoleState.runText(selectTableSql({ ...browse, dialect }), {
      asTable: true,
      browse,
      filters: [],
      replaceEditor: false,
    })
  }, [browse, dialect, consoleState, snapshot])

  // Return to the view we drilled from (restores its SELECT + browse so editing + FK links re-light).
  const goBack = useCallback(() => {
    setBackStack((s) => {
      const prev = s[s.length - 1]
      if (!prev) return s
      void consoleState.runText(prev.sql, {
        asTable: !!prev.browse && prev.filters.length === 0,
        browse: prev.browse,
        filters: prev.filters,
        replaceEditor: false,
      })
      return s.slice(0, -1)
    })
  }, [consoleState])

  return {
    canGoBack: backStack.length > 0,
    resetBackStack,
    onCellLink,
    onCellFilter,
    onColumnFilter,
    onClearFilters,
    goBack,
  }
}
