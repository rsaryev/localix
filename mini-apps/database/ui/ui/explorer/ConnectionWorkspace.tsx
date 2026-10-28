import { useState } from 'react'
import { Database, SquareTerminal } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { StatusDot } from '@localixai/kit/status-dot'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { canEditSchema } from '../../model/connectionTreeRows'
import { DIALECT_LABEL } from '../../model/dialects'
import { ConnectionBadges } from '../ConnectionBadge'
import { CreateTableDialog } from '../CreateTableDialog'
import { ReconnectCard, useReconnectProblem } from '../ReconnectCard'
import { SchemaSidebar } from '../SchemaSidebar'
import { connectionStatus } from '../schema-tree/ConnectionRow'
import { ConnectionActions } from './ConnectionActions'
import { connectionMenuEntries, newConsoleFor, type ExplorerState } from './connectionMenuEntries'

/** One connection's tab: its header, and its schema browser (or the reconnect card). */
export function ConnectionWorkspace({ s }: { s: ExplorerState }) {
  const connection = s.selected
  const [creatingTable, setCreatingTable] = useState(false)
  // Above the early returns AND above the connected/disconnected branch: this pane outlives both,
  // so it is the only thing here that can report a failed reconnect and then say it ended.
  const reconnectProblem = useReconnectProblem(
    connection,
    !!(connection && s.reconnecting[connection.id]),
    connection ? s.reconnectError[connection.id] : undefined,
    () => {
      if (connection) void s.ensureConnected(connection.id, { force: true })
    },
    () => {
      if (connection) s.removeConnection(connection.id)
    },
  )

  // Another connection starts without the create-table dialog open: reset while rendering.
  const [dialogConnectionId, setDialogConnectionId] = useState(connection?.id)
  if (dialogConnectionId !== connection?.id) {
    setDialogConnectionId(connection?.id)
    setCreatingTable(false)
  }

  if (s.loading && !connection) {
    return <LoadingHint className="h-full">Loading connection…</LoadingHint>
  }
  if (!connection) {
    return (
      <StateNotice
        icon={Database}
        title="Connection unavailable"
        body="This saved connection no longer exists."
      />
    )
  }

  const displayName = connectionDisplayName(connection)
  const editable = canEditSchema(connection)

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        tone="content"
        title={
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot
              size="sm"
              className={connection.connected ? 'bg-status-success' : 'bg-text-faint'}
              label={connectionStatus(connection.connected, !!s.reconnecting[connection.id])}
            />
            <span className="truncate text-xs font-semibold text-foreground">{displayName}</span>
            <span className="shrink-0 text-2xs text-text-faint">
              {DIALECT_LABEL[connection.dialect]}
            </span>
            <ConnectionBadges readonly={connection.readonly} hasSsh={connection.hasSsh} />
          </div>
        }
        actions={
          <>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => newConsoleFor(s.sessionId, connection)}
            >
              <SquareTerminal className="size-3" />
              New query
            </Button>
            <ConnectionActions
              displayName={displayName}
              entries={() =>
                connectionMenuEntries(connection, s, {
                  includeNewQuery: false,
                  onCreateTable: editable ? () => setCreatingTable(true) : undefined,
                })
              }
            />
          </>
        }
      />

      {connection.connected ? (
        <div className="min-h-0 flex-1">
          <SchemaSidebar
            connection={connection}
            schema={s.schema}
            onOpenTable={s.onOpenTable}
            onInsertColumn={s.onInsertColumn}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ReconnectCard
            connection={connection}
            error={s.reconnectError[connection.id]}
            problem={reconnectProblem}
          />
        </div>
      )}

      <CreateTableDialog
        key={connection.id}
        open={creatingTable}
        connection={connection}
        schemas={Object.keys(s.schema.schemas ?? {})}
        onOpenChange={setCreatingTable}
        onOpenSql={s.onOpenSql}
      />
    </div>
  )
}
