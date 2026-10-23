import { acknowledgeInline, toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import type { DbConnectionInfo, UpdateConfigRequest } from '../dbClient'
import { databaseApi, DbApiError } from '../api/databaseApi'
import { dbProblem } from '../problems'
import { ownRecordValue } from '../../shared/safe-record'
import {
  bumpOperation,
  getConnectionsSnapshot,
  reconnects,
  removing,
  revisionOf,
  setReconnectError,
  setReconnecting,
  updateConnections,
} from './connectionsStore'
import { schemaStore } from './schemaStore'
import { transactionStore } from './sql-console/transactionStore'

/**
 * Every write to the saved-connection list, applied to the ONE store (`connectionsStore.ts`).
 *
 * Module functions rather than per-hook callbacks: when each `useDbConnections` instance owned
 * these, a rename in one connection tab updated only that tab's copy, and the in-flight guards
 * (`reconnects`, `removing`, the operation revisions) were per instance too — two tabs could
 * reconnect the same id twice. One owner makes both the state and the guards shared.
 */

const findConnection = (id: string) =>
  getConnectionsSnapshot().connections.find((connection) => connection.id === id)

const markDisconnected = (id: string) =>
  updateConnections((current) =>
    current.map((c) => (c.id === id ? { ...c, connected: false, flags: undefined } : c)),
  )

function clearReconnect(id: string): void {
  reconnects.delete(id)
  setReconnecting(id, false)
}

/** Insert or replace a connection (after connect / reconnect / rename). */
export function upsertConnection(conn: DbConnectionInfo): void {
  // Remove is terminal for its in-flight window: a late connect/reconnect response must not put
  // the row back after the server has deleted its saved config.
  if (removing.has(conn.id)) return
  bumpOperation(conn.id)
  clearReconnect(conn.id)
  transactionStore.syncConnection(conn)
  updateConnections((current) => {
    const index = current.findIndex((c) => c.id === conn.id)
    if (index < 0) return [...current, conn]
    const next = [...current]
    next[index] = conn
    return next
  })
}

/**
 * Bring a disconnected connection live. Rapid select + click + focus-refire collapse to one
 * reconnect through `reconnects`, without making later callers falsely observe `undefined`. A
 * prior failure parks the id (no auto-retry) until `force` (the Retry button) clears it.
 */
export function ensureConnected(
  id: string,
  opts?: { force?: boolean },
): Promise<DbConnectionInfo | undefined> {
  const pending = reconnects.get(id)
  if (pending) return pending
  const conn = findConnection(id)
  if (!conn || conn.connected || removing.has(id))
    return Promise.resolve(conn?.connected ? conn : undefined)
  if (!opts?.force && ownRecordValue(getConnectionsSnapshot().reconnectError, id))
    return Promise.resolve(undefined)

  const revision = bumpOperation(id)
  setReconnecting(id, true)
  setReconnectError(id, null)
  // Declared before it is assigned: a synchronous throw inside the body reaches `finally`
  // before the assignment, and a `const` there would be a TDZ ReferenceError.
  let attempt!: Promise<DbConnectionInfo | undefined>
  attempt = (async () => {
    try {
      const live = await databaseApi.reconnect(id)
      if (revisionOf(id) !== revision || removing.has(id)) return undefined
      // Drop any stale schema cached while the driver was down so the tree/console
      // re-introspect the fresh driver.
      schemaStore.invalidate(id)
      upsertConnection(live)
      return live
    } catch (e) {
      if (revisionOf(id) === revision && !removing.has(id)) {
        acknowledgeInline(e)
        setReconnectError(id, dbProblem(e, 'Could not reconnect to this database.'))
      }
      return undefined
    } finally {
      if (reconnects.get(id) === attempt) clearReconnect(id)
    }
  })()
  reconnects.set(id, attempt)
  return attempt
}

/**
 * The server answered `connection_not_found` for a row this UI still shows connected: its live
 * driver went with a backend restart or mini app reload. Correct the row first — `ensureConnected`
 * treats a connected row as nothing to do — then reconnect, forced, because a person asked for
 * this request just now; a parked auto-retry must not refuse it.
 */
export function reviveConnection(id: string): Promise<DbConnectionInfo | undefined> {
  if (!reconnects.has(id)) {
    bumpOperation(id)
    transactionStore.markClosed(id)
    markDisconnected(id)
  }
  return ensureConnected(id, { force: true })
}

/** Close the live driver but keep the saved entry. */
export async function disconnectConnection(id: string): Promise<void> {
  const revision = bumpOperation(id)
  clearReconnect(id)
  // Only the routine 404 — a driver that already self-cleaned — counts as disconnected. Any
  // other rejection used to be swallowed, and the row read "disconnected" while the socket (and
  // any open transaction) was still live on the server.
  const failure = await databaseApi
    .disconnect(id)
    .then(() => null)
    .catch((e: unknown) =>
      e instanceof DbApiError && e.code === 'connection_not_found' ? null : e,
    )
  if (failure !== null) {
    const name = findConnection(id)?.name
    toast.error(`Could not disconnect ${name ? `“${name}”` : 'this connection'}`, {
      description: errorMessage(failure, '') || undefined,
    })
    return
  }
  if (revisionOf(id) !== revision || removing.has(id)) return
  bumpOperation(id)
  transactionStore.markClosed(id)
  markDisconnected(id)
}

/**
 * Forget a saved connection. Only a CONFIRMED delete drops the row: dropping it regardless made a
 * connection vanish while still saved server-side, and it silently came back on the next list.
 * The reason is RETURNED so the server's own words reach the caller.
 */
export async function removeConnection(id: string): Promise<Problem | null> {
  bumpOperation(id)
  removing.add(id)
  clearReconnect(id)
  const name = findConnection(id)?.name
  const failure = await databaseApi
    .remove(id)
    .then(() => null)
    .catch((e: unknown) =>
      dbProblem(e, `Could not delete ${name ? `“${name}”` : 'this connection'}.`),
    )
  try {
    if (!failure) {
      bumpOperation(id)
      transactionStore.markClosed(id)
      updateConnections((current) => current.filter((c) => c.id !== id))
    }
    return failure
  } finally {
    removing.delete(id)
  }
}

/** Rename a connection (no-op on an empty name). A refused rename says why. */
export async function renameConnection(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const revision = bumpOperation(id)
  const previous = findConnection(id)?.name
  const updated = await databaseApi.rename(id, trimmed).catch((e: unknown) => {
    toast.error(`Could not rename ${previous ? `“${previous}”` : 'this connection'}`, {
      description: errorMessage(e, '') || undefined,
    })
    return null
  })
  if (updated && revisionOf(id) === revision) upsertConnection(updated)
}

/** Edit a connection's config in place; a validation failure rejects and touches nothing. */
export async function updateConnectionConfig(
  id: string,
  req: UpdateConfigRequest,
): Promise<DbConnectionInfo> {
  const revision = bumpOperation(id)
  const updated = await databaseApi.updateConfig(id, req)
  if (revisionOf(id) === revision) upsertConnection(updated)
  return updated
}

/**
 * Ping a connection so a dropped one (server restart, network loss) stops reading as
 * "connected". A failure of OUR api is ignored — only a definitive `alive:false` flips it.
 */
export async function healthCheckConnection(id: string): Promise<void> {
  if (reconnects.has(id) || removing.has(id)) return
  const revision = revisionOf(id)
  const alive = await databaseApi.ping(id).catch(() => true)
  if (alive || revisionOf(id) !== revision || removing.has(id)) return
  bumpOperation(id)
  transactionStore.markClosed(id)
  markDisconnected(id)
  // Clear a parked error so auto-reconnect fires for this fresh drop.
  setReconnectError(id, null)
}
