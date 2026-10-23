/**
 * The live-driver entry shape + the small pure helpers around it (naming, target
 * identity, probing, the wire `DbConnectionInfo` projection, and teardown of one
 * entry). Shared by the service facade and the live-registry — holds no state.
 */
import {
  isFileConnectionConfig,
  isNetworkConnectionConfig,
  type ConnectRequest,
  type DbConnectionConfig,
  type DbConnectionInfo,
} from '../contracts'
import type { DbDriver, DbTransaction, DriverFlags } from '../drivers/port'
import type { ExclusiveQueue } from '../drivers/exclusive-queue'
import type { TunnelHandle } from '../ssh-tunnel'
import type { SavedConnection } from '../store'
import { getDatabaseDriverManifest } from '../../shared/driver-catalog'
import { splitConnectionUrlPassword } from '../../shared/connection-url'
import { mssqlAdoTarget } from '../mssql-connection-string'

export interface LiveEntry {
  driver: DbDriver
  flags: DriverFlags
  /** Mirror of the saved config's `readonly` flag — the query guard reads it without
   *  re-loading the store. Refreshed whenever the live driver is (re)established. */
  readonly: boolean
  /**
   * True when the ENGINE is enforcing read-only for this connection, not just the text
   * classifier. False for an engine with no such switch (see `read-only/server-guard.ts`)
   * or one that rejected it — in both cases the classifier is the only guard, which is
   * worth being able to tell apart when reasoning about what a read-only connection
   * actually guarantees.
   */
  serverReadOnly: boolean
  /** Queries currently in flight: controller → completion barrier. `cancel()` aborts the
   *  controllers; teardown also awaits every barrier before rolling back/closing the driver. */
  inflight: Map<AbortController, Promise<void>>
  /** Non-cancellable driver work (atomic batches — cancelling one mid-COMMIT would report
   *  "cancelled" for a write that lands; browse is a read and goes through `inflight`). Teardown
   *  drains these barriers before rolling back/closing underneath the operation. */
  inflightOperations: Set<Promise<void>>
  /** Metadata reads use the ordinary driver and may be queued behind a pinned manual
   *  transaction. Teardown rolls that transaction back first, then drains these reads. */
  inflightMetadata: Set<Promise<void>>
  /** Set once this detached entry starts teardown. Operations waiting on a transaction
   *  transition check it before touching the driver. */
  closing: boolean
  /** Sanitized successful query shapes, newest first, used only as bounded model context. */
  recentQueries: string[]
  /** An open MANUAL transaction ("Tx: Manual"), pinned to one connection. When
   *  set, `query` routes through it so several statements share one uncommitted tx until
   *  the caller commits/rolls back. Undefined = auto-commit (each query on a fresh conn). */
  activeTx?: DbTransaction
  /** FIFO over the active transaction's pinned connection. Different consoles/API callers
   *  may submit concurrently, but one physical transaction must execute statements and its
   *  final COMMIT/ROLLBACK in a deterministic, non-overlapping order. */
  activeTxQueue?: ExclusiveQueue
  /** A beginTransaction call in flight. Concurrent Begin requests share it, and teardown
   *  invalidates/awaits it so a late pinned transaction cannot survive disconnect. */
  openingTx?: Promise<DbTransaction>
  /** COMMIT/ROLLBACK in flight. The active slot is cleared before settlement starts, but
   *  subsequent work must wait for this barrier instead of escaping onto another pooled
   *  connection before the prior transaction has actually finished. */
  settlingTx?: Promise<void>
  /** SSH tunnel the driver connects through, when the config carries an `ssh` block.
   *  Closed alongside the driver on disconnect/remove/health-drop. */
  tunnel?: TunnelHandle
}

export function defaultName(req: ConnectRequest): string {
  if (req.name) return req.name
  if (isFileConnectionConfig(req.config)) {
    const label = getDatabaseDriverManifest(req.config.dialect).label
    if (req.config.file === ':memory:' || req.config.file === ':memory') return `In-memory ${label}`
    return req.config.file.split(/[\\/]/).pop() || req.config.file
  }
  return getDatabaseDriverManifest(req.config.dialect).label
}

// Strip only the password component of URL authority. A connection's credential may rotate
// without changing its target, just as the field-mode key below deliberately excludes
// `config.password`. Keeping this lexical also covers database URLs that WHATWG URL rejects
// (for example a multi-host MongoDB URI).
const URL_SCHEME_RE = /^[a-zA-Z][\w+.-]*:\/\//

function urlTarget(url: string): string {
  const trimmed = url.trim()
  const parts = splitConnectionUrlPassword(trimmed)
  return parts ? `${parts.head}@${parts.tail}` : trimmed
}

function sshRoute(config: DbConnectionConfig): [string, string, number] | null {
  if (!isNetworkConnectionConfig(config) || !config.ssh) return null
  // The route distinguishes identically named private endpoints behind different bastions.
  // Authentication material is intentionally absent so rotating it still folds onto the
  // same saved connection. Normalize the omitted default port to explicit 22.
  return [config.ssh.user, config.ssh.host, config.ssh.port ?? 22]
}

/** Identity of a connection target — used to fold a re-connect to the same DB onto its
 *  existing saved entry instead of piling up duplicates. */
export function configKey(config: DbConnectionConfig): string {
  if (isFileConnectionConfig(config)) {
    return JSON.stringify([config.dialect, 'file', config.file])
  }
  // A connection is keyed by its URL, or (field mode) by its host/port/user/database — so a
  // re-connect to the same target folds onto the existing entry instead of duplicating.
  const route = sshRoute(config)
  if (config.url) {
    const target =
      config.dialect === 'mssql' && !URL_SCHEME_RE.test(config.url.trim())
        ? mssqlAdoTarget(config.url)
        : urlTarget(config.url)
    return JSON.stringify([config.dialect, 'url', target, route])
  }
  return JSON.stringify([
    config.dialect,
    'fields',
    config.host ?? null,
    config.port ?? null,
    config.database ?? null,
    config.user ?? null,
    route,
  ])
}

/** Engine-agnostic connectivity probe: the driver's own `probe()` (Redis `PING`,
 *  Mongo/ES `ping`) when it has one, else `SELECT 1`. Throws the raw driver error. */
export async function probeDriver(driver: DbDriver): Promise<void> {
  if (driver.probe) await driver.probe()
  else await driver.query('SELECT 1')
}

export function infoFrom(saved: SavedConnection, live: LiveEntry | undefined): DbConnectionInfo {
  return {
    id: saved.id,
    name: saved.name,
    dialect: saved.config.dialect,
    connected: !!live,
    readonly: !!saved.config.readonly,
    // Only meaningful once a session exists to have been asked; omitted while disconnected
    // rather than reported as `false`, which would read as "the engine refused".
    ...(live && saved.config.readonly ? { serverReadOnly: live.serverReadOnly } : {}),
    color: saved.config.color,
    hasSsh: isNetworkConnectionConfig(saved.config) && !!saved.config.ssh,
    flags: live?.flags,
    txOpen: !!live?.activeTx,
    createdAt: saved.createdAt,
  }
}

/** Tear down a live entry: roll back any open manual transaction FIRST (so a pinned
 *  connection is released and uncommitted work is discarded, never silently committed),
 *  then close the driver AND its SSH tunnel (if any). Used by disconnect/remove/
 *  updateConfig/connect-replace/ping-dead/closeAll. */
export async function closeLive(live: LiveEntry | undefined): Promise<void> {
  if (!live) return
  live.closing = true
  // A teardown must not roll back a manual transaction or close its driver underneath a
  // query that already acquired this live entry. Abort first, then wait for each runQuery
  // `finally` barrier. The entry has already been detached by the registry, so no new query
  // can join while this drains.
  const runningQueries = [...live.inflight.entries()]
  for (const [controller] of runningQueries) {
    controller.abort(new Error('Database connection was closed.'))
  }
  // Resolve transaction transitions before draining non-cancellable operations. A batch
  // can be waiting for Begin/Commit; invalidating or settling that transition lets it wake,
  // observe `closing`, and leave without starting new work on the detached driver.
  if (live.settlingTx) {
    await live.settlingTx.catch(() => {})
  }
  if (live.openingTx) {
    const opening = live.openingTx
    // Invalidate before awaiting: the begin caller must not install the transaction when
    // it resumes. Both sides may attempt rollback; DbTransaction settlement is idempotent.
    live.openingTx = undefined
    const tx = await opening.catch(() => undefined)
    await tx?.rollback().catch(() => {})
  }
  await Promise.all([...runningQueries.map(([, done]) => done), ...live.inflightOperations])
  if (live.activeTx) {
    const tx = live.activeTx
    const queue = live.activeTxQueue
    live.activeTx = undefined
    live.activeTxQueue = undefined
    await (queue ? queue.run(() => tx.rollback()) : tx.rollback()).catch(() => {})
  }
  await Promise.all(live.inflightMetadata)
  await live.driver.close().catch(() => {})
  await live.tunnel?.close().catch(() => {})
}
