import { useCallback, useMemo } from 'react'
import type { DbDialect } from './dbClient'
import { useDbConsoleCommands } from './model/useDbConsoleCommands'
import { useEngineConsole } from './model/useEngineConsole'
import { useSchema } from './model/useSchema'
import { useSqlNextEdit } from './model/useSqlNextEdit'
import { quoteIdent, selectTableSql } from './model/sqlIdent'
import { SqlConsole } from './ui/SqlConsole'
import { useBrowseNavigation } from './db-console-tab/useBrowseNavigation'
import { useRowEditGate } from './db-console-tab/useRowEditGate'
import { useSqlEditorModel } from './db-console-tab/useSqlEditorModel'
import { useSqlCatalog } from './model/sql-diagnostics/useSqlCatalog'
import { useEngineCheck } from './model/sql-diagnostics/useEngineCheck'
import { sqlPredictionContextReferences } from './model/sqlPredictionContext'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'

/**
 * One connection's SQL console as a center editor-grid tab (one tab per
 * connection). This is the old workbench body minus the schema tree — the tree now
 * lives in the left Database sidebar, which drives this console through
 * `dbConsoleBus` (open a table's `SELECT *`, insert a column name).
 *
 * Results render in RESULT TABS (each opened table / executed query its
 * own tab, deduped by identity; non-row outcomes + errors in a singleton Output log) —
 * the tab state lives in `useSqlConsole`. The BROWSE target + drill filters are stored
 * PER TAB (in the tab metadata), so switching tabs restores the right row-edit gating +
 * filter chip; the drill-back stack lives in `useBrowseNavigation`.
 */
export function DbConsoleTab({
  consoleId,
  connectionId,
  dialect,
  readonly = false,
  dbLabel,
  publishMessageContext,
}: {
  /** Unique id of THIS console instance (the WorkItem id). Keys the editor draft so several
   *  consoles on the same connection each keep their own in-progress query. */
  consoleId: string
  connectionId: string
  dialect: DbDialect
  /** Read-only connection — the server blocks writes, so the console offers no row
   *  editing (no cell edit / add-row / delete-row). */
  readonly?: boolean
  /** Connection name, echoed as the `<db>>` prompt prefix in the Output console log. */
  dbLabel?: string
  publishMessageContext?: PublishMessageContext
}) {
  const { history, consoleState } = useEngineConsole({
    connectionId,
    consoleId,
    dbLabel,
    dialect,
    draftNoun: 'SQL draft',
    language: 'sql',
    publishMessageContext,
  })
  const schema = useSchema(connectionId)
  // The active result tab drives everything below (browse target + drill filters live
  // ON the tab, so switching tabs restores the right context automatically).
  const active = consoleState.active
  const browse = active?.kind === 'result' ? (active.browse ?? null) : null
  const browseFilters = useMemo(
    () => (active?.kind === 'result' ? (active.filters ?? []) : []),
    [active],
  )
  const activeSql = active?.kind === 'result' ? (active.sql ?? '') : ''

  const { editTarget, fkLinks, linkColumns } = useRowEditGate({
    readonly,
    browse,
    activeSql,
    active,
    schema,
    consoleState,
    dialect,
    connectionId,
  })

  const nav = useBrowseNavigation({
    consoleState,
    dialect,
    browse,
    browseFilters,
    activeSql,
    active,
    fkLinks,
  })

  // Open a table: load its columns (for PK-aware row editing), run its generated SELECT
  // into a tab keyed by the table (so re-opening reuses + refreshes that tab).
  const { resetBackStack } = nav
  const openTable = useCallback(
    (table: string, schemaName?: string) => {
      schema.loadTable(table, schemaName)
      resetBackStack() // opening a table from the tree is a fresh navigation context
      void consoleState.runText(selectTableSql({ table, schema: schemaName, dialect }), {
        asTable: true,
        browse: { table, schema: schemaName },
        filters: [],
        replaceEditor: false, // opening a table must never wipe the editor draft
      })
    },
    [consoleState, dialect, schema, resetBackStack],
  )

  const insertColumn = useCallback(
    (column: string) => {
      const ident = quoteIdent(column, dialect)
      const cur = consoleState.getText()
      consoleState.setSql(cur.length > 0 ? `${cur.replace(/\s*$/, '')} ${ident}` : ident)
    },
    [consoleState, dialect],
  )

  // Sidebar commands (stable subscription; see useDbConsoleCommands).
  useDbConsoleCommands(connectionId, (cmd) => {
    if (cmd.kind === 'open-table') openTable(cmd.table, cmd.schema)
    else if (cmd.kind === 'insert-column') insertColumn(cmd.column)
    else consoleState.setSql(cmd.sql)
  })

  const { tableNameSet, columnNameSet, completionSource } = useSqlEditorModel(
    schema,
    consoleState.getText,
  )
  const { catalog, onWantColumns } = useSqlCatalog(schema)
  const engineCheck = useEngineCheck(connectionId)
  // A successful run changes the server-resolved recent-query context. Carry a
  // content-free revision in the callback identity so Monaco drops any prediction
  // cached for the same document/cursor under the previous context.
  const predictionContextRevision = history.entries
    .slice(0, 6)
    .map((entry) => entry.at)
    .join(':')

  // The mini app identifies its active connection + focused tables; the backend
  // Context Fabric resolver decides whether/how their live schema becomes context.
  const nextEditSource = useSqlNextEdit(
    useCallback(
      (request: Parameters<typeof sqlPredictionContextReferences>[0]['request']) =>
        sqlPredictionContextReferences({
          connectionId,
          connectionLabel: dbLabel ?? connectionId,
          schemas: schema.schemas,
          request,
          contextRevision: predictionContextRevision,
        }),
      [connectionId, dbLabel, predictionContextRevision, schema.schemas],
    ),
  )

  return (
    <SqlConsole
      console={consoleState}
      dialect={dialect}
      completionSource={completionSource}
      nextEditSource={nextEditSource}
      history={history}
      edit={editTarget}
      linkColumns={linkColumns}
      onCellLink={nav.onCellLink}
      onCellFilter={browse ? nav.onCellFilter : undefined}
      onColumnFilter={browse ? nav.onColumnFilter : undefined}
      filterCount={browseFilters.length}
      onClearFilters={nav.onClearFilters}
      onBack={nav.canGoBack ? nav.goBack : undefined}
      showTransactions={!readonly}
      tableNames={tableNameSet}
      onOpenTable={openTable}
      columnNames={columnNameSet}
      catalog={catalog}
      onWantColumns={onWantColumns}
      engineCheck={engineCheck}
      connectionLabel={dbLabel}
    />
  )
}
