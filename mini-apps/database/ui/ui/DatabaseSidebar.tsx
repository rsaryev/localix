import { Plus, X } from 'lucide-react'
import { ProblemLine, ProblemState } from '@localixai/mini-app-sdk/ui/components'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { IconButton } from '@localixai/kit/icon-button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { ConnectForm } from './ConnectForm'
import { ConnectionPicker } from './database-sidebar/ConnectionPicker'
import { SidebarDetail } from './database-sidebar/SidebarDetail'
import { useDatabaseSidebar } from './database-sidebar/useDatabaseSidebar'
import type { DbConnectionsState } from '../model/useDbConnections'
import { DatabaseExplorer } from './DatabaseExplorer'
import type { DatabaseArea, DatabaseResourceTarget } from '../model/databaseView'
import { useDbProblem } from '../problems'

/**
 * The Database navigator: a compact searchable connection switcher with status/actions, plus
 * the schema browser for the selected connection. Picking a live connection (or double-clicking
 * a table) opens that connection's SQL console as a center editor-grid tab; several connections
 * open = several tabs. Its connection registry is injected by the tab that hosts it, and so is
 * the chat those tabs open in — the host tab's own session.
 */
export function DatabaseSidebarView({
  sessionId,
  connectionModel,
  requestedConnectionId,
  requestAddNonce,
  requestedObjectTarget,
  initialArea,
  embedded = false,
  connectionOnly = false,
}: {
  /** The chat every tab this navigator opens belongs to. */
  sessionId: string
  connectionModel: DbConnectionsState
  requestedConnectionId?: string
  requestAddNonce?: number
  requestedObjectTarget?: DatabaseResourceTarget
  initialArea?: DatabaseArea
  embedded?: boolean
  connectionOnly?: boolean
}) {
  const s = useDatabaseSidebar(sessionId, connectionModel, {
    requestedConnectionId,
    requestAddNonce,
    strictSelection: connectionOnly,
    // Embedded without a connection is the Connections root: its tree loads per node.
    browsesSchema: !embedded || connectionOnly,
  })
  // ONE owner per subject. Embedded, this view renders nothing of its own — DatabaseExplorer below
  // shows and owns the same two reports, and a second publisher would settle the first's row.
  const listProblem = useDbProblem('saved connections', embedded ? null : s.listError, {
    consequence: s.connections.length === 0 ? 'blocked' : 'stale',
    actions: [{ id: 'retry', label: 'Retry', run: s.refreshList }],
  })
  const removeProblem = useDbProblem('this connection', embedded ? null : s.removeError)

  if (embedded) {
    return (
      <>
        <DatabaseExplorer
          s={s}
          requestedTarget={requestedObjectTarget}
          initialArea={initialArea}
          connectionOnly={connectionOnly}
        />
        <ConfirmDialog
          open={s.confirmRemove !== null}
          title="Delete connection?"
          description={
            s.confirmRemoveName
              ? `“${s.confirmRemoveName}” and its saved config will be removed.`
              : ''
          }
          confirmLabel="Delete"
          onConfirm={s.onConfirmRemove}
          onClose={() => s.setConfirmRemove(null)}
        />
      </>
    )
  }

  // No `bg-sidebar` coat: the host's sidebar panel is the outermost painter of that ground, and
  // under the macOS glass theme the token carries alpha — a second pane-sized coat compounds into
  // an opaque slab. On the opaque themes it is the identical color, so inheriting changes nothing.
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Databases"
        tone="sidebar"
        actions={
          <IconButton
            size="sm"
            tooltip={s.adding ? 'Cancel new connection' : 'New connection'}
            tooltipSide="bottom"
            aria-label={s.adding ? 'Cancel new connection' : 'New connection'}
            aria-pressed={s.adding}
            onClick={() => s.setAdding(!s.adding)}
          >
            {s.adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          </IconButton>
        }
      />

      {s.editingConfig ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <ConnectForm
            key={s.editingConfig.connection.id}
            edit={{
              connection: s.editingConfig.connection,
              config: s.editingConfig.config,
              save: (req) => s.updateConfig(s.editingConfig!.connection.id, req),
            }}
            onConnected={s.onConfigSaved}
            onCancel={() => s.setEditingConfig(null)}
          />
        </div>
      ) : s.showForm ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <ConnectForm
            onConnected={s.onConnected}
            onCancel={s.connections.length > 0 ? () => s.setAdding(false) : undefined}
          />
        </div>
      ) : s.loading && s.connections.length === 0 ? (
        // The mount list() hasn't answered yet — neither the form nor "no connections"
        // may be claimed, so hold the panel on a quiet loading line (the workbench
        // ladder is loading → error → empty → rows).
        //
        // `connections.length === 0` is the whole point, and matches how DatabaseExplorer
        // already reads the same flag. `loading` is also set by every refreshList — the
        // inline "Connections did not refresh · Retry" below is one — so gating on the flag
        // ALONE replaced a populated panel with this line mid-session, throwing away the
        // schema tree, its expansion state and the scroll position to re-announce
        // something the user could already see.
        <LoadingHint>Loading connections…</LoadingHint>
      ) : listProblem && s.connections.length === 0 ? (
        <ProblemState {...listProblem} />
      ) : (
        <>
          <div className="shrink-0">
            <ConnectionPicker
              connections={s.connections}
              selected={s.selected}
              reconnecting={s.reconnecting}
              editing={s.editing}
              setEditing={s.setEditing}
              commitRename={s.commitRename}
              onPick={s.onClickConnection}
              onEditConfig={(connection) => void s.startEditConfig(connection)}
              onRemove={s.removeConnection}
            />
            {/* A failed fetch still names itself here WITH a retry — mount-only fetching
                would otherwise dead-end the panel until a full remount. */}
            {listProblem && <ProblemLine {...listProblem} className="px-3 py-1.5" />}
            {removeProblem && <ProblemLine {...removeProblem} className="px-3 py-1.5" />}
          </div>

          <SidebarDetail
            selected={s.selected}
            schema={s.schema}
            reconnecting={s.reconnecting}
            reconnectError={s.reconnectError}
            onOpenTable={s.onOpenTable}
            onInsertColumn={s.onInsertColumn}
            onRetry={(conn) => {
              void s.ensureConnected(conn.id, { force: true }).then((live) => {
                if (live) s.openConsole(live)
              })
            }}
            onRemove={s.removeConnection}
          />
        </>
      )}

      {/* Delete gate: the actions menu / ReconnectCard Remove only stage the id — the actual
          remove() (and console close) waits for this explicit confirm. */}
      <ConfirmDialog
        open={s.confirmRemove !== null}
        title="Delete connection?"
        description={
          s.confirmRemoveName
            ? `“${s.confirmRemoveName}” and its saved config will be removed.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={s.onConfirmRemove}
        onClose={() => s.setConfirmRemove(null)}
      />
    </div>
  )
}
