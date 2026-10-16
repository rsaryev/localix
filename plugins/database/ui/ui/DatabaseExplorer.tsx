import { useEffect } from 'react'
import type { DatabaseArea, DatabaseResourceTarget } from '../model/databaseView'
import { connectionDisplayName } from '../model/connectionDisplayName'
import { openDbConnection, openDbTable } from '../model/openConsole'
import { ConnectForm } from './ConnectForm'
import { ConnectionsTree } from './explorer/ConnectionsTree'
import { ConnectionWorkspace } from './explorer/ConnectionWorkspace'
import type { ExplorerState } from './explorer/connectionMenuEntries'

/**
 * Database navigation follows the same split as the physical references:
 * the root work item is a compact connection tree; opening a connection creates
 * a stable schema-browser tab; tables and consoles are independent work items.
 */
export function DatabaseExplorer({
  s,
  requestedTarget,
  initialArea: _initialArea,
  connectionOnly = false,
}: {
  s: ExplorerState
  requestedTarget?: DatabaseResourceTarget
  initialArea?: DatabaseArea
  connectionOnly?: boolean
}) {
  useEffect(() => {
    if (!requestedTarget) return
    const connection = s.connections.find((item) => item.id === requestedTarget.connectionId)
    if (!connection) return
    if (requestedTarget.table) {
      openDbTable({
        sessionId: s.sessionId,
        connectionId: connection.id,
        connectionName: connectionDisplayName(connection),
        dialect: connection.dialect,
        readonly: connection.readonly,
        color: connection.color,
        table: requestedTarget.table,
        schema: requestedTarget.schema,
      })
    } else {
      openDbConnection(s.sessionId, connection)
    }
  }, [requestedTarget, s.connections, s.sessionId])

  if (s.editingConfig) {
    return (
      <ConnectForm
        key={s.editingConfig.connection.id}
        variant="workspace"
        edit={{
          connection: s.editingConfig.connection,
          config: s.editingConfig.config,
          save: (request) => s.updateConfig(s.editingConfig!.connection.id, request),
        }}
        onConnected={s.onConfigSaved}
        onCancel={() => s.setEditingConfig(null)}
      />
    )
  }

  if (!connectionOnly && s.showForm) {
    return (
      <ConnectForm
        variant="workspace"
        onConnected={(connection) => {
          s.onConnected(connection)
          openDbConnection(s.sessionId, connection)
        }}
        onCancel={s.connections.length > 0 ? () => s.setAdding(false) : undefined}
      />
    )
  }

  return connectionOnly ? <ConnectionWorkspace s={s} /> : <ConnectionsTree s={s} />
}
