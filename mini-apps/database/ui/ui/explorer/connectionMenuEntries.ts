import {
  Network,
  Pencil,
  SlidersHorizontal,
  SquareTerminal,
  TableProperties,
  Trash2,
  Unplug,
} from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { DATABASE_DRIVER_CATALOG } from '../../../shared/driver-catalog'
import type { DbConnectionInfo } from '../../dbClient'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { dbConsoleBus } from '../../model/dbConsoleBus'
import { newDbConsole, openDbConsole, openDbDiagram } from '../../model/openConsole'
import type { useDatabaseSidebar } from '../database-sidebar/useDatabaseSidebar'

export type ExplorerState = ReturnType<typeof useDatabaseSidebar>

/** A new console for `connection`, in the chat `sessionId` — the explorer's own tab's chat. */
export function newConsoleFor(sessionId: string, connection: DbConnectionInfo): void {
  newDbConsole(
    sessionId,
    connection.id,
    connectionDisplayName(connection),
    connection.dialect,
    connection.readonly,
    connection.color,
  )
}

export function openConsoleFor(
  sessionId: string,
  connection: DbConnectionInfo,
  sql?: string,
): void {
  openDbConsole(
    sessionId,
    connection.id,
    connectionDisplayName(connection),
    connection.dialect,
    connection.readonly,
    connection.color,
  )
  if (sql) dbConsoleBus.send(sessionId, connection.id, { kind: 'set-query', sql })
}

/**
 * Everything you can do to a connection, described once.
 *
 * The tree row reaches it two ways — the kebab that appears on hover, and a right-click anywhere
 * on the row — and the connection header reaches it a third. Written as JSX per call site those
 * would drift; described here they cannot.
 */
export function connectionMenuEntries(
  connection: DbConnectionInfo,
  s: ExplorerState,
  {
    includeNewQuery = true,
    onCreateTable,
  }: { includeNewQuery?: boolean; onCreateTable?: () => void } = {},
): MenuEntry[] {
  const displayName = connectionDisplayName(connection)
  const entries: MenuEntry[] = []
  if (includeNewQuery)
    entries.push({
      id: 'new-console',
      label: 'New query console',
      icon: SquareTerminal,
      onSelect: () => newConsoleFor(s.sessionId, connection),
    })
  if (DATABASE_DRIVER_CATALOG[connection.dialect].capabilities.relationships)
    entries.push({
      id: 'diagram',
      label: 'Relationship diagram',
      icon: Network,
      onSelect: () => openDbDiagram(s.sessionId, connection),
    })
  if (onCreateTable)
    entries.push({
      id: 'create-table',
      label: 'Create table…',
      icon: TableProperties,
      onSelect: onCreateTable,
    })
  entries.push(
    { separator: true },
    {
      id: 'rename',
      label: 'Rename',
      icon: Pencil,
      onSelect: () => s.setEditing({ id: connection.id, draft: displayName }),
    },
    {
      id: 'edit-config',
      label: 'Edit connection…',
      icon: SlidersHorizontal,
      onSelect: () => void s.startEditConfig(connection),
    },
  )
  if (connection.connected)
    entries.push({
      id: 'disconnect',
      label: 'Disconnect',
      icon: Unplug,
      onSelect: () => void s.disconnect(connection.id),
    })
  entries.push(
    { separator: true },
    {
      id: 'delete',
      label: 'Delete connection…',
      icon: Trash2,
      danger: true,
      onSelect: () => s.removeConnection(connection.id),
    },
  )
  return entries
}
