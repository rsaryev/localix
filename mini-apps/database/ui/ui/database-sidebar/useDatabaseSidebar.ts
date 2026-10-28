import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { DbConnectionConfig, DbConnectionInfo } from '../../dbClient'
import { openDbConnection, openDbTable, type DbTableOpenMode } from '../../model/openConsole'
import { openConsoleFor } from '../explorer/connectionMenuEntries'
import { dbConsoleBus } from '../../model/dbConsoleBus'
import { databaseApi } from '../../api/databaseApi'
import { loadDatabaseConnectionId, saveDatabaseConnectionId } from '../../model/databaseView'
import type { DbConnectionsState } from '../../model/useDbConnections'
import { useSchema } from '../../model/useSchema'
import { schemaStore } from '../../model/schemaStore'
import { shouldShowConnectForm } from '../../model/connectFormVisibility'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { useRemoveConnection } from './useRemoveConnection'

export interface RenameDraft {
  id: string
  draft: string
}

/**
 * All state + behavior for the Database sidebar: the connection list (selection,
 * rename, config-edit, filter, grouping) plus schema loading / health-check /
 * auto-reconnect for the selected connection. The view stays JSX-only.
 */
export function useDatabaseSidebar(
  /** The chat whose tabs this navigator opens — the tab hosting it. Carried on the returned
   *  state so every explorer action (menus, tree rows) opens into the same chat. */
  sessionId: string,
  connectionModel: DbConnectionsState,
  {
    requestedConnectionId,
    requestAddNonce,
    strictSelection = false,
    browsesSchema = true,
  }: {
    requestedConnectionId?: string
    requestAddNonce?: number
    strictSelection?: boolean
    /** Whether this surface renders the SELECTED connection's schema through `schema`. The
     *  embedded Connections root does not — each expanded tree node reads its own. */
    browsesSchema?: boolean
  } = {},
) {
  const {
    connections,
    loading,
    listError,
    refreshList,
    reconnecting,
    reconnectError,
    ensureConnected,
    upsert,
    disconnect,
    remove,
    rename,
    updateConfig,
    healthCheck,
  } = connectionModel
  const [selectedId, setSelectedId] = useState<string | null>(
    () => requestedConnectionId ?? loadDatabaseConnectionId(),
  )
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<RenameDraft | null>(null)
  // A connection whose full config is being edited in the ConnectForm (fetched on open,
  // since the list `DbConnectionInfo` never carries the config).
  const [editingConfig, setEditingConfig] = useState<{
    connection: DbConnectionInfo
    config: DbConnectionConfig
  } | null>(null)
  const editConfigRequest = useRef(0)
  const changeAdding = useCallback((next: boolean) => {
    editConfigRequest.current += 1
    setAdding(next)
    if (next) setEditingConfig(null)
  }, [])
  const closeEditingConfig = useCallback((_next: null) => {
    editConfigRequest.current += 1
    setEditingConfig(null)
  }, [])

  // Derived selection: the user's explicit pick when it still exists, else an
  // auto-pick (prefer a live connection) so a schema shows without a click. Derived
  // rather than an auto-select effect — no setState-in-effect, and it never opens a
  // console tab unbidden (that only happens on an explicit click).
  const selected = useMemo(() => {
    if (selectedId) {
      const picked = connections.find((c) => c.id === selectedId)
      if (picked) return picked
    }
    if (strictSelection) return null
    return connections.find((c) => c.connected) ?? connections[0] ?? null
  }, [connections, selectedId, strictSelection])
  const selectedIdEff = selected?.id ?? null

  // Resource anchors can focus a nested table/column from anywhere in the app, and Overview's
  // "New connection" action switches to Explorer and opens the form (a nonce lets it be requested
  // again after the form was cancelled). Both requests apply while rendering; only persisting the
  // selection, a side effect, waits for the commit.
  const [applied, setApplied] = useState<{ id?: string; nonce?: number }>({})
  if (applied.id !== requestedConnectionId || applied.nonce !== requestAddNonce) {
    setApplied({ id: requestedConnectionId, nonce: requestAddNonce })
    if (requestedConnectionId && applied.id !== requestedConnectionId)
      setSelectedId(requestedConnectionId)
    if (requestAddNonce && applied.nonce !== requestAddNonce) {
      setAdding(true)
      setEditingConfig(null)
    }
  }
  useEffect(() => {
    if (requestedConnectionId) saveDatabaseConnectionId(requestedConnectionId)
  }, [requestedConnectionId])
  // Layout phase, so a config fetch still in flight is already stale before anything resolves.
  useLayoutEffect(() => {
    if (requestAddNonce) editConfigRequest.current += 1
  }, [requestAddNonce])

  // One schema instance for the SELECTED connection's tree. Guarded empty id → no fetch.
  // Only where something renders it: the Connections root used to introspect whichever
  // connection was auto-selected (the whole object list, plus the column prefetch) on every
  // open, for a tree whose nodes each load their own schema on expand.
  const schema = useSchema(browsesSchema && selected?.connected ? selected.id : '')

  // Health-check the selected live connection (on select + window focus) so a dropped
  // one auto-reconnects (below) instead of silently failing the schema/console.
  useEffect(() => {
    if (!selected?.connected) return
    void healthCheck(selected.id)
    const onFocus = () => void healthCheck(selected.id)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [selected?.id, selected?.connected, healthCheck])

  // Auto-reconnect the selected-but-disconnected connection (fresh load, or after a
  // dropped-driver health check) — no manual button. `ensureConnected` de-dupes and
  // stands down after a failure, so a dead host surfaces the error card, not a spin.
  // Passive: it never opens a console tab (that's an explicit click, see below).
  const selectedConnected = selected?.connected ?? false
  useEffect(() => {
    if (selectedIdEff && !selectedConnected) void ensureConnected(selectedIdEff)
  }, [selectedIdEff, selectedConnected, ensureConnected])

  const openConsole = useCallback(
    (conn: DbConnectionInfo) => openConsoleFor(sessionId, conn),
    [sessionId],
  )

  /** Select a connection for Explorer without opening a console tab. */
  const selectConnection = useCallback((conn: DbConnectionInfo) => {
    setSelectedId(conn.id)
    saveDatabaseConnectionId(conn.id)
  }, [])

  // Click a connection: select it and open/focus its stable schema-browser tab.
  // Reconnection continues in the background; the tab owns the visible retry state.
  const onClickConnection = useCallback(
    (conn: DbConnectionInfo) => {
      selectConnection(conn)
      openDbConnection(sessionId, conn)
      if (!conn.connected) void ensureConnected(conn.id)
    },
    [sessionId, ensureConnected, selectConnection],
  )

  // Open a table from its tree row or one of the explicit edit actions. Each table has
  // one stable work-item tab; `mode` is a fresh navigation intent for that existing tab.
  // A table's filters, page and staged edits therefore survive while other tables and
  // consoles are opened, matching the work-item lifecycle used everywhere in Localix.
  const onOpenTable = useCallback(
    (table: string, schemaName?: string, mode?: DbTableOpenMode) => {
      if (!selected) return
      openDbTable({
        sessionId,
        connectionId: selected.id,
        connectionName: connectionDisplayName(selected),
        dialect: selected.dialect,
        readonly: selected.readonly,
        color: selected.color,
        table,
        schema: schemaName,
        mode,
      })
    },
    [sessionId, selected],
  )
  const onInsertColumn = useCallback(
    (column: string) => {
      if (!selected) return
      dbConsoleBus.send(sessionId, selected.id, { kind: 'insert-column', column })
    },
    [sessionId, selected],
  )
  const onOpenSql = useCallback(
    (sql: string) => {
      if (!selected) return
      openConsole(selected)
      dbConsoleBus.send(sessionId, selected.id, { kind: 'set-query', sql })
    },
    [sessionId, selected, openConsole],
  )

  const onConnected = useCallback(
    (conn: DbConnectionInfo) => {
      upsert(conn)
      setSelectedId(conn.id)
      saveDatabaseConnectionId(conn.id)
      setAdding(false)
    },
    [upsert],
  )

  const commitRename = useCallback(() => {
    if (editing?.draft.trim()) void rename(editing.id, editing.draft.trim())
    setEditing(null)
  }, [editing, rename])

  // Open the full config editor for a connection: fetch its stored config (URL/file),
  // then swap the panel to a pre-filled ConnectForm in edit mode.
  const startEditConfig = useCallback(async (conn: DbConnectionInfo) => {
    const request = ++editConfigRequest.current
    try {
      const { config } = await databaseApi.getConfig(conn.id)
      if (editConfigRequest.current !== request) return
      setEditingConfig({ connection: conn, config })
    } catch (cause) {
      // "Edit connection…" that opens nothing must say why; the empty catch made a dead backend
      // or a vanished connection indistinguishable from a click that never registered.
      if (editConfigRequest.current !== request) return
      toast.error(`Could not open the settings of “${connectionDisplayName(conn)}”`, {
        description: errorMessage(cause, '') || undefined,
      })
    }
  }, [])

  // After a successful config edit the id is unchanged, so the console draft/history and
  // any open tab survive; re-open the console for the (now live) connection.
  const onConfigSaved = useCallback(
    (conn: DbConnectionInfo) => {
      // Config may have re-pointed the connection to a different target — drop the
      // cached schema so the tree/console re-introspect the fresh driver.
      schemaStore.invalidate(conn.id)
      upsert(conn)
      setSelectedId(conn.id)
      saveDatabaseConnectionId(conn.id)
      setEditingConfig(null)
    },
    [upsert],
  )

  // Staging a removal cancels a pending "Edit connection…" fetch for the row about to go.
  const cancelEditConfig = useCallback(() => {
    editConfigRequest.current += 1
  }, [])
  const removal = useRemoveConnection(connections, remove, cancelEditConfig)

  // An empty list means "add your first connection" ONLY when the server said so — see
  // shouldShowConnectForm for why, and for the truth table that pins it.
  const showForm = shouldShowConnectForm({
    adding,
    loading,
    connectionCount: connections.length,
    listError,
  })

  return {
    sessionId,
    connections,
    loading,
    listError,
    refreshList,
    reconnecting,
    reconnectError,
    ensureConnected,
    disconnect,
    updateConfig,
    selected,
    selectedIdEff,
    schema,
    adding,
    setAdding: changeAdding,
    editing,
    setEditing,
    editingConfig,
    setEditingConfig: closeEditingConfig,
    openConsole,
    selectConnection,
    onClickConnection,
    onOpenTable,
    onOpenSql,
    onInsertColumn,
    onConnected,
    commitRename,
    startEditConfig,
    onConfigSaved,
    ...removal,
    showForm,
  }
}
