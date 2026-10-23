import { useEffect } from 'react'
import { Database, Plug, Unplug } from 'lucide-react'
import type { MenuEntry, StatusItemState } from '@localixai/mini-app-sdk/ui'
import {
  miniAppWorkspace,
  runMiniAppAction,
  statusMenuList,
  tonedIcon,
} from '@localixai/mini-app-sdk/ui'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'

import type { DbConnectionInfo } from './dbClient'
import { databaseApi } from './api/databaseApi'
import { connectionDisplayName } from './model/connectionDisplayName'
import { useStoreChanges } from '@localixai/mini-app-sdk/ui/store-resource'
import { refreshConnections } from './model/connectionsStore'
import { ensureConnectionsListed, useConnectionsSnapshot } from './model/connectionsStore'
import { openDbConnection } from './model/openConsole'

const WORKSPACE_KIND = 'database:workspace'
/** A connection's live state on its menu row: the success ink when connected, quiet when not. */
const LIVE_ICON = tonedIcon(Plug, 'success')
const OFFLINE_ICON = tonedIcon(Unplug, 'neutral')

/**
 * Which database is live, and the writability that decides what a query can do to it.
 *
 * The name alone would be a label; `readonly` is what makes this worth chrome. A connection that
 * is NOT read-only will run an `UPDATE` the moment one is typed or generated, and the panel says
 * so only while you are looking at the panel. Surfacing it as a tone means the answer is present
 * at the moment a query is being written, which is when it matters.
 *
 * No saved connections means nothing to report and nothing to switch between — no control at all.
 * Every row and the click open a database tab, which belongs to a chat; outside one (`sessionId`
 * null) there is nowhere to open it, so there is no control either.
 */
export function useDatabaseStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = useMiniAppWorkspace()
  // The same store the Database tabs and .sql files read, so a connect or rename there is here
  // at once — and the titlebar is not a separate copy of the list with its own request.
  useStoreChanges({ miniApp: 'database', sessionId: null }, refreshConnections)
  const { connections: list } = useConnectionsSnapshot()
  useEffect(() => ensureConnectionsListed(), [])

  const focusedId = workspace.focusedId
  const active = focusedId ? workspace.items[focusedId]?.kind === WORKSPACE_KIND : false

  if (!sessionId || list.length === 0) return null

  const live = list.filter((connection) => connection.connected)
  const writable = live.filter((connection) => !connection.readonly)

  const open = () =>
    miniAppWorkspace.openWorkItem({
      workKind: WORKSPACE_KIND,
      id: WORKSPACE_KIND,
      title: 'Database',
      scope: sessionId,
    })

  /**
   * GO TO this database — the row's whole meaning, and the thing it was missing.
   *
   * It used to toggle the connection instead: choosing a row opened a socket in the background and
   * put nothing on screen. The item's own text changed, which made it look like something had
   * happened somewhere, and the only honest reading of the gesture — "show me this database" — was
   * the one it did not do. Connecting is now a step on the way to the tab, not the destination.
   *
   * No refresh here: `databaseApi.reconnect` invalidates the topic and the store follows it.
   */
  const reveal = (connection: DbConnectionInfo) => {
    if (connection.connected) {
      openDbConnection(sessionId, connection)
      return
    }
    runMiniAppAction(
      () =>
        databaseApi
          .reconnect(connection.id)
          .then((reconnected) => openDbConnection(sessionId, reconnected)),
      `Could not connect to “${connectionDisplayName(connection)}”`,
    )
  }

  const disconnect = (connection: DbConnectionInfo) =>
    runMiniAppAction(
      () => databaseApi.disconnect(connection.id),
      `Could not disconnect “${connectionDisplayName(connection)}”`,
    )

  /**
   * Dropping a connection, kept OFF the rows above so one gesture never means two things.
   *
   * One live connection is one row; several are a submenu. A panel to reach a single row is a
   * hover for nothing, and the same rule decides the shape of a folded mini app in the `…` menu.
   */
  const disconnectEntries: MenuEntry[] =
    live.length === 0
      ? []
      : live.length === 1
        ? [
            {
              id: 'disconnect',
              label: `Disconnect ${connectionDisplayName(live[0]!)}`,
              icon: Unplug,
              onSelect: () => disconnect(live[0]!),
            },
          ]
        : [
            {
              id: 'disconnect',
              label: 'Disconnect',
              icon: Unplug,
              hint: String(live.length),
              items: live.map((connection) => ({
                id: `disconnect:${connection.id}`,
                label: connectionDisplayName(connection),
                onSelect: () => disconnect(connection),
              })),
            },
          ]

  return {
    label:
      live.length === 0
        ? 'Database — nothing connected'
        : live.length === 1
          ? `Database — connected to ${connectionDisplayName(live[0]!)}${live[0]!.readonly ? ' (read-only)' : ''}`
          : `Database — ${live.length} connections live`,
    Icon: Database,
    ...(live.length === 1 ? { text: connectionDisplayName(live[0]!) } : {}),
    ...(live.length > 1 ? { badge: { count: live.length } } : {}),
    // Writable and live is the state worth a colour: a generated statement lands on real rows.
    // Read-only, or nothing connected at all, is the quiet case and reads as one.
    ...(writable.length > 0 ? { tone: 'warning' as const } : {}),
    active,
    onClick: () => (active && focusedId ? miniAppWorkspace.closeWorkItems(focusedId) : open()),
    menu: [
      { id: 'open', label: 'Open Database', icon: Database, onSelect: open },
      { separator: true },
      // Inline rather than behind a `Connections ▸` trigger: connecting IS what this menu is for,
      // and a submenu put the only useful rows one hover further away than the panel they replace.
      ...statusMenuList({
        header: 'Connections',
        items: list,
        row: (connection) => ({
          id: `connection:${connection.id}`,
          label: connectionDisplayName(connection),
          // Live or not is a STATE, not a choice, so it is the row's toned glyph and not a check:
          // a `checked` row is a toggle, and choosing it here never unchecks anything — it opens
          // the tab. The check also took the glyph's slot, so live and offline rows differed
          // only by a mark that read as "selected".
          icon: connection.connected ? LIVE_ICON : OFFLINE_ICON,
          // What a query is about to be allowed to do, on the row that decides it. It used to be
          // readable only from the item's tooltip, and only for a single live connection.
          hint: [connection.connected ? 'live' : 'offline', connection.readonly && 'read-only']
            .filter(Boolean)
            .join(' · '),
          onSelect: () => reveal(connection),
        }),
        onOverflow: open,
        overflowLabel: (hidden) => `${hidden} more connections…`,
      }),
      { separator: true },
      ...disconnectEntries,
    ],
  }
}
