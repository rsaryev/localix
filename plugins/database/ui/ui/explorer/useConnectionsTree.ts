import { useCallback, useMemo, useState } from 'react'
import type { DbConnectionInfo } from '../../dbClient'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { connectionRowKey, flattenConnectionRows } from '../../model/connectionTreeRows'
import { dbConsoleBus } from '../../model/dbConsoleBus'
import { openDbConnection, openDbTable } from '../../model/openConsole'
import { useTreeToggles } from '../../model/schemaTreeNavigation'
import { useSchemaSources } from '../../model/useSchemaSources'
import { useDdlTarget } from '../schema-tree/DdlPreviewDialog'
import { useStableActions, type SchemaTreeActions } from '../schema-tree/actions'
import {
  activateObjectRow,
  objectMenuEntries,
  setObjectRowOpen,
  type ObjectMenuContext,
} from '../schema-tree/objectRowActions'
import { useConnectionProblemLines } from './ConnectionProblems'
import {
  connectionMenuEntries,
  newConsoleFor,
  openConsoleFor,
  type ExplorerState,
} from './connectionMenuEntries'

/**
 * The connections root's model: which connections are open, whose schemas that subscribes to,
 * the flat rows, and the one stable action set the rows call.
 */
export function useConnectionsTree(s: ExplorerState, connections: readonly DbConnectionInfo[]) {
  const { isOpen, setOpen, reset } = useTreeToggles()
  const ddl = useDdlTarget()
  const [createTarget, setCreateTarget] = useState<{
    connection: DbConnectionInfo
    schemaName: string
  } | null>(null)
  const problems = useConnectionProblemLines()

  // Subscribe to exactly the schemas on screen: open, connected connections — plus the one a
  // DDL dialog is reading, which must not lose its source when its connection collapses.
  const subscribed = useMemo(() => {
    const ids = connections
      .filter((c) => c.connected && isOpen(connectionRowKey(c.id), false))
      .map((c) => c.id)
    if (ddl.target && !ids.includes(ddl.target.connectionId)) ids.push(ddl.target.connectionId)
    return ids
  }, [connections, isOpen, ddl.target])
  const readers = useSchemaSources(subscribed)

  const rows = useMemo(
    () =>
      flattenConnectionRows({
        connections,
        readers,
        isOpen,
        renaming: s.editing,
        reconnecting: s.reconnecting,
        reconnectError: (id) =>
          Object.hasOwn(s.reconnectError, id) ? s.reconnectError[id]?.message : undefined,
        problemLine: problems.lineFor,
      }),
    [connections, readers, isOpen, s.editing, s.reconnecting, s.reconnectError, problems.lineFor],
  )

  const byId = (id: string) => s.connections.find((c) => c.id === id)
  const contextFor = (connection: DbConnectionInfo): ObjectMenuContext => ({
    dialect: connection.dialect,
    openTable: (table, schema, mode) =>
      openDbTable({
        sessionId: s.sessionId,
        connectionId: connection.id,
        connectionName: connectionDisplayName(connection),
        dialect: connection.dialect,
        readonly: connection.readonly,
        color: connection.color,
        table,
        schema,
        mode,
      }),
    insertColumn: (column) => {
      openConsoleFor(s.sessionId, connection)
      dbConsoleBus.send(s.sessionId, connection.id, { kind: 'insert-column', column })
    },
    viewDdl: (table, schema) => {
      readers.get(connection.id)?.loadTable(table, schema)
      ddl.open({ connectionId: connection.id, table, schema })
    },
    loadTable: (table, schema) => readers.get(connection.id)?.loadTable(table, schema),
    setOpen,
  })

  const actions = useStableActions<SchemaTreeActions>({
    setOpen: (row, open) => {
      const connection = byId(row.connectionId)
      if (!connection) return
      if (row.kind !== 'connection') return setObjectRowOpen(row, open, contextFor(connection))
      setOpen(row.key, open)
      s.selectConnection(connection)
      if (open && !connection.connected) void s.ensureConnected(connection.id, { force: true })
    },
    activate: (row) => {
      const connection = byId(row.connectionId)
      if (!connection) return
      if (row.kind !== 'connection') return activateObjectRow(row, contextFor(connection))
      s.selectConnection(connection)
      openDbConnection(s.sessionId, connection)
    },
    openRef: (row) => {
      const connection = byId(row.connectionId)
      if (connection && row.refTable) contextFor(connection).openTable(row.refTable)
    },
    retryColumns: (row) => {
      if (row.table) readers.get(row.connectionId)?.reloadTable(row.table, row.schemaArg)
    },
    menuFor: (row) => {
      const connection = byId(row.connectionId)
      if (!connection) return null
      if (row.kind === 'connection') return connectionMenuEntries(connection, s)
      return objectMenuEntries(row, contextFor(connection))
    },
    createTable: (connectionId, schemaName) => {
      const connection = byId(connectionId)
      if (connection) setCreateTarget({ connection, schemaName })
    },
    newConsole: (connectionId) => {
      const connection = byId(connectionId)
      if (connection) newConsoleFor(s.sessionId, connection)
    },
    renameChange: (id, draft) => s.setEditing({ id, draft }),
    renameCommit: () => s.commitRename(),
    renameCancel: () => s.setEditing(null),
  })

  const retryConnect = useCallback(
    (connectionId: string) => void s.ensureConnected(connectionId, { force: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sidebar's action is stable
    [s.ensureConnected],
  )

  return {
    rows,
    actions,
    readers,
    ddl,
    ddlConnection: ddl.target ? byId(ddl.target.connectionId) : undefined,
    createTarget,
    closeCreate: () => setCreateTarget(null),
    collapseAll: reset,
    retryConnect,
    reportLines: problems.report,
  }
}
