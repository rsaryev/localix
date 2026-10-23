import { useCallback, useMemo } from 'react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { ConnectionColor, DbConnectionInfo, DbDialect } from './dbClient'
import { dbConsoleBus } from './model/dbConsoleBus'
import { openDbConsole, type DbTableOpenMode } from './model/openConsole'
import { useSchema } from './model/useSchema'
import { TableDataWorkspace } from './ui/TableDataWorkspace'

/**
 * A first-class table work item. Each connection/schema/table identity owns one tab,
 * so paging, filters, structure view and staged grid edits stay isolated from every
 * other open table and SQL console.
 */
export function DbTableTab({
  sessionId,
  connectionId,
  connectionName,
  dialect,
  readonly,
  color,
  table,
  schema: schemaName,
  requestedMode,
  requestNonce,
  publishMessageContext,
}: {
  /** The chat this tab belongs to — where the consoles it opens go. */
  sessionId: string
  publishMessageContext?: PublishMessageContext
  connectionId: string
  connectionName: string
  dialect: DbDialect
  readonly?: boolean
  color?: ConnectionColor
  table: string
  schema?: string
  requestedMode?: DbTableOpenMode
  requestNonce?: string
}) {
  const schema = useSchema(connectionId)
  const connection = useMemo<DbConnectionInfo>(
    () => ({
      id: connectionId,
      name: connectionName,
      dialect,
      connected: true,
      readonly: readonly ?? false,
      color,
      createdAt: 0,
    }),
    [color, connectionId, connectionName, dialect, readonly],
  )

  const openConsole = useCallback(() => {
    openDbConsole(sessionId, connectionId, connectionName, dialect, readonly, color)
    dbConsoleBus.send(sessionId, connectionId, {
      kind: 'open-table',
      table,
      schema: schemaName,
    })
  }, [sessionId, color, connectionId, connectionName, dialect, readonly, schemaName, table])

  const openConsoleWithSql = useCallback(
    (sql: string) => {
      openDbConsole(sessionId, connectionId, connectionName, dialect, readonly, color)
      dbConsoleBus.send(sessionId, connectionId, { kind: 'set-query', sql })
    },
    [sessionId, color, connectionId, connectionName, dialect, readonly],
  )

  return (
    <TableDataWorkspace
      connection={connection}
      target={{ table, schema: schemaName }}
      schema={schema}
      requestedMode={requestedMode}
      requestNonce={requestNonce}
      onOpenConsole={openConsole}
      onOpenConsoleWithSql={openConsoleWithSql}
      publishMessageContext={publishMessageContext}
    />
  )
}
