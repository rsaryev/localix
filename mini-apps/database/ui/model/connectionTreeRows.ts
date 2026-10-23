import { DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import type { DbConnectionInfo } from '../dbClient'
import type { SchemaItemMatch } from './schemaSearch'
import {
  pushObjectRows,
  treeKey,
  type IsOpen,
  type SchemaReader,
  type SchemaTreeRow,
} from './schemaTreeRows'

/** Stable empty column list, so an unfiltered wrap does not churn the rows' props. */
const NO_COLUMNS: string[] = []

/** Whether the person may create tables / edit structure on this connection. */
export const canEditSchema = (connection: DbConnectionInfo): boolean =>
  !connection.readonly && DATABASE_DRIVER_CATALOG[connection.dialect].capabilities.schemaEditing

export const connectionRowKey = (connectionId: string): string => treeKey(connectionId)

export interface ConnectionRowsInput {
  connections: readonly DbConnectionInfo[]
  /** The schema of every OPEN, connected connection. */
  readers: ReadonlyMap<string, SchemaReader>
  isOpen: IsOpen
  renaming: { id: string; draft: string } | null
  reconnecting: Readonly<Record<string, boolean>>
  /** A standing failure's message per connection, when there is one. */
  reconnectError: (connectionId: string) => string | undefined
  /**
   * The owned problem line for a connection's reconnect or schema failure. Owned ELSEWHERE — by a
   * component that stays mounted — because a row that scrolls out of the window unmounts, and a
   * report owned by a row would be settled in the Event Center the moment it scrolled away.
   */
  problemLine: (
    connectionId: string,
    which: 'reconnect' | 'schema',
  ) => MiniAppProblemLineProps | null
}

/**
 * The connections root as flat rows: one row per saved connection and, under an open one, either
 * the single state it is in (connecting, failed, disconnected, loading, empty) or its objects.
 * The same precedence the nested tree had, so nothing changes about WHAT a person sees.
 */
export function flattenConnectionRows(input: ConnectionRowsInput): SchemaTreeRow[] {
  const rows: SchemaTreeRow[] = []
  for (const connection of input.connections) {
    const connectionId = connection.id
    const key = connectionRowKey(connectionId)
    const open = input.isOpen(key, false)
    const reconnecting = !!input.reconnecting[connectionId]
    rows.push({
      kind: 'connection',
      key,
      depth: 0,
      connectionId,
      connection,
      open,
      renameDraft: input.renaming?.id === connectionId ? input.renaming.draft : null,
      reconnecting,
    })
    if (!open) continue
    const status = (status: 'connecting' | 'disconnected' | 'loading' | 'no-objects') =>
      rows.push({
        kind: 'status',
        key: treeKey(connectionId, status),
        depth: 1,
        connectionId,
        status,
      })
    const problem = (which: 'reconnect' | 'schema', message: string) =>
      rows.push({
        kind: 'status',
        key: treeKey(connectionId, 'p', which),
        depth: 1,
        connectionId,
        status: 'problem',
        message,
        line: input.problemLine(connectionId, which),
      })
    const reader = input.readers.get(connectionId)
    const reconnectError = input.reconnectError(connectionId)
    if (reconnecting) status('connecting')
    else if (reconnectError) problem('reconnect', reconnectError)
    else if (!connection.connected) status('disconnected')
    else if (reader?.error) problem('schema', reader.error)
    else if (!reader?.schemas) status('loading')
    else {
      const groups = Object.entries(reader.schemas).map(
        ([name, items]) =>
          [
            name,
            items.map((item): SchemaItemMatch => ({
              item,
              reason: 'name',
              matchedColumns: NO_COLUMNS,
            })),
          ] as const,
      )
      if (groups.length === 0) status('no-objects')
      else
        pushObjectRows(rows, {
          connection,
          reader,
          groups,
          baseDepth: 1,
          schemaRows: 'always',
          schemaDefaultOpen: groups.length === 1,
          searchActive: false,
          canEditSchema: canEditSchema(connection),
          isOpen: input.isOpen,
        })
    }
  }
  return rows
}
