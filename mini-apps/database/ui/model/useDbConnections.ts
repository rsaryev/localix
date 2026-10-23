import { useStoreChanges } from '@localixai/mini-app-sdk/ui/store-resource'
import { useEffect, useMemo } from 'react'
import { useVisiblePolling, useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import type { DbConnectionInfo, UpdateConfigRequest } from '../dbClient'
import {
  disconnectConnection,
  ensureConnected,
  healthCheckConnection,
  removeConnection,
  renameConnection,
  updateConnectionConfig,
  upsertConnection,
} from './connectionsActions'
import {
  CONNECTIONS_POLL_MS,
  ensureConnectionsListed,
  pollConnections,
  refreshConnections,
  useConnectionsSnapshot,
} from './connectionsStore'

export interface DbConnectionsState {
  connections: DbConnectionInfo[]
  /** True until the first `list()` (or a `refreshList`) settles. While set, an empty
   *  `connections` means "still asking", not "you have none" — the sidebar must show a
   *  loading hint, never the new-connection form, for saved connections still in flight. */
  loading: boolean
  /** Why the saved-connection list is missing, when it is. `null` with an empty
   *  `connections` means the server genuinely has none — the two must stay tellable
   *  apart: one invites "add your first connection", the other must not. A whole
   *  {@link Problem}, so the backend's own words survive the trip to the Event Center. */
  listError: Problem | null
  /** Re-run the `list()` fetch (clearing `listError` first) — the Retry for a failed
   *  fetch, so a transient blip doesn't dead-end the panel until a remount. */
  refreshList: () => void
  /** Ids currently being (re)established, for a "Connecting…" affordance. */
  reconnecting: Record<string, boolean>
  /** Last reconnect failure per id (cleared on a fresh attempt / success). While set,
   *  auto-reconnect stands down for that id until an explicit retry. */
  reconnectError: Record<string, Problem>
  /** Insert or replace a connection (after connect / reconnect / rename). */
  upsert: (conn: DbConnectionInfo) => void
  /** Bring a saved-but-disconnected connection live. Idempotent + de-duped: a no-op
   *  when already connected or an attempt is in flight, and (unless `force`) skips an id
   *  that failed its last attempt so a dead host can't spin. Resolves with the now-live
   *  connection on success, else `undefined` (error surfaced via `reconnectError`). */
  ensureConnected: (id: string, opts?: { force?: boolean }) => Promise<DbConnectionInfo | undefined>
  /** Close the live driver but keep the saved entry. */
  disconnect: (id: string) => Promise<void>
  /** Forget a saved connection entirely. Resolves NULL when the server confirmed the
   *  delete — only then does the list drop it. Otherwise it resolves the reason, and the
   *  row stays where it is, because it is still saved. */
  remove: (id: string) => Promise<Problem | null>
  /** Rename a connection (no-op on an empty name). */
  rename: (id: string, name: string) => Promise<void>
  /** Edit a connection's config (URL/file) and optionally its name, keeping its id.
   *  Resolves with the refreshed connection; rejects (surfacing the engine error) if the
   *  new config fails validation, leaving the list untouched. */
  updateConfig: (id: string, req: UpdateConfigRequest) => Promise<DbConnectionInfo>
  /** Ping the connection; flip it to disconnected if the driver has dropped. */
  healthCheck: (id: string) => Promise<void>
}

/** Stable module functions: every reader gets the same identities, so effects keyed on them
 *  never re-run because a sibling surface re-rendered. */
const ACTIONS = {
  refreshList: refreshConnections,
  upsert: upsertConnection,
  ensureConnected,
  disconnect: disconnectConnection,
  remove: removeConnection,
  rename: renameConnection,
  updateConfig: updateConnectionConfig,
  healthCheck: healthCheckConnection,
} as const

/**
 * The saved-connection registry as one surface sees it: a VIEW of the process-wide
 * `connectionsStore` plus its actions. Every instance reads the same snapshot, so a rename or a
 * connect in one tab is on every other tab and the titlebar at once.
 *
 * A parked work item asks for nothing: the list is requested when a surface first becomes
 * visible and is then shared. A connection the agent added arrives as a pushed change
 * (`databaseChanges.ts`); while a surface is visible it also polls slowly (`useVisiblePolling`,
 * {@link CONNECTIONS_POLL_MS}) as a backstop, and showing the tab again re-reads only a list older
 * than half a poll window.
 */
export function useDbConnections(): DbConnectionsState {
  const workItemVisible = useWorkItemVisible()
  const snapshot = useConnectionsSnapshot()
  useEffect(() => {
    if (workItemVisible) ensureConnectionsListed()
  }, [workItemVisible])
  const live = useStoreChanges({ miniApp: 'database', sessionId: null }, refreshConnections)
  useVisiblePolling({
    enabled: !live,
    intervalMs: CONNECTIONS_POLL_MS,
    immediate: true,
    onTick: pollConnections,
  })
  return useMemo(
    () => ({
      connections: snapshot.connections,
      loading: snapshot.loading,
      listError: snapshot.listError,
      reconnecting: snapshot.reconnecting,
      reconnectError: snapshot.reconnectError,
      ...ACTIONS,
    }),
    [snapshot],
  )
}
