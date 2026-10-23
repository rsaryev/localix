import { useCallback, useMemo } from 'react'

import type { ConnectionColor, DbConnectionInfo, DbDialect } from './dbClient'
import { openDbTable } from './model/openConsole'
import { useSchema } from './model/useSchema'
import { DatabaseDiagram } from './ui/DatabaseDiagram'

/** A first-class, connection-scoped ERD work item. Its canvas camera, focus and search
 * remain independent from every schema browser, table and console tab. */
export function DbDiagramTab({
  sessionId,
  connectionId,
  connectionName,
  dialect,
  readonly,
  color,
}: {
  /** The chat this tab belongs to — where the tables it opens go. */
  sessionId: string
  connectionId: string
  connectionName: string
  dialect: DbDialect
  readonly?: boolean
  color?: ConnectionColor
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
  const openTable = useCallback(
    (target: { table: string; schema?: string }) =>
      openDbTable({
        sessionId,
        connectionId,
        connectionName,
        dialect,
        readonly,
        color,
        table: target.table,
        schema: target.schema,
      }),
    [sessionId, color, connectionId, connectionName, dialect, readonly],
  )

  return <DatabaseDiagram connection={connection} schema={schema} onOpenTable={openTable} />
}
