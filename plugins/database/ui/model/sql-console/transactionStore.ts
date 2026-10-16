import type { DbConnectionInfo } from '../../dbClient'
import { databaseApi } from '../../api/databaseApi'

export interface TransactionSnapshot {
  txMode: 'auto' | 'manual'
  txOpen: boolean
  txBusy: boolean
  txNotice: string | null
}

interface Entry {
  snapshot: TransactionSnapshot
  listeners: Set<() => void>
  transition: Promise<void> | null
  transitionRevision: number
  refreshRequest: number
  refresh: Promise<void> | null
}

const EMPTY: TransactionSnapshot = {
  txMode: 'auto',
  txOpen: false,
  txBusy: false,
  txNotice: null,
}
const entries = new Map<string, Entry>()

function getEntry(connectionId: string): Entry {
  let entry = entries.get(connectionId)
  if (!entry) {
    entry = {
      snapshot: EMPTY,
      listeners: new Set(),
      transition: null,
      transitionRevision: 0,
      refreshRequest: 0,
      refresh: null,
    }
    entries.set(connectionId, entry)
  }
  return entry
}

function update(entry: Entry, patch: Partial<TransactionSnapshot>): void {
  const next = { ...entry.snapshot, ...patch }
  if (
    next.txMode === entry.snapshot.txMode &&
    next.txOpen === entry.snapshot.txOpen &&
    next.txBusy === entry.snapshot.txBusy &&
    next.txNotice === entry.snapshot.txNotice
  )
    return
  entry.snapshot = next
  for (const listener of entry.listeners) listener()
}

function applyConnection(entry: Entry, connection: DbConnectionInfo | undefined): void {
  const txOpen = !!connection?.connected && !!connection.txOpen
  update(entry, {
    txOpen,
    // A server-side transaction may outlive every console component. Hydrating it as
    // Auto would hide Commit/Rollback even though every query is still pinned to it.
    txMode: txOpen ? 'manual' : entry.snapshot.txMode,
  })
}

function runTransition(entry: Entry, task: () => Promise<void>): Promise<void> {
  if (entry.transition) return entry.transition
  const revision = ++entry.transitionRevision
  update(entry, { txBusy: true })
  const transition = task().finally(() => {
    if (entry.transitionRevision === revision) {
      entry.transition = null
      update(entry, { txBusy: false })
    }
  })
  entry.transition = transition
  return transition
}

async function refresh(connectionId: string): Promise<void> {
  if (!connectionId) return
  const entry = getEntry(connectionId)
  if (entry.refresh) return entry.refresh
  const request = ++entry.refreshRequest
  const transitionRevision = entry.transitionRevision
  const pending = databaseApi
    .list()
    .then((connections) => {
      if (
        entry.refreshRequest !== request ||
        entry.transitionRevision !== transitionRevision ||
        entry.transition
      )
        return
      applyConnection(
        entry,
        connections.find((connection) => connection.id === connectionId),
      )
    })
    .finally(() => {
      if (entry.refresh === pending) entry.refresh = null
    })
  entry.refresh = pending
  return pending
}

async function ensureOpen(connectionId: string): Promise<void> {
  if (!connectionId) return
  const entry = getEntry(connectionId)
  while (entry.snapshot.txMode === 'manual') {
    // A query requested while COMMIT/ROLLBACK is in flight belongs after that boundary.
    // Wait, then open the next manual transaction instead of escaping through Auto.
    if (entry.transition) {
      await entry.transition
      continue
    }
    if (entry.snapshot.txOpen) return
    await runTransition(entry, async () => {
      const connection = await databaseApi.beginTx(connectionId)
      applyConnection(entry, connection)
      if (!connection.connected || !connection.txOpen)
        throw new Error('The database connection closed before the transaction began.')
      update(entry, { txMode: 'manual', txNotice: 'BEGIN' })
    })
  }
}

async function settle(connectionId: string, op: 'commit' | 'rollback'): Promise<void> {
  if (!connectionId) return
  const entry = getEntry(connectionId)
  if (entry.transition) await entry.transition
  if (!entry.snapshot.txOpen) return
  await runTransition(entry, async () => {
    const connection =
      op === 'commit'
        ? await databaseApi.commitTx(connectionId)
        : await databaseApi.rollbackTx(connectionId)
    applyConnection(entry, connection)
    update(entry, { txNotice: op === 'commit' ? 'COMMIT' : 'ROLLBACK' })
  })
}

export const transactionStore = {
  subscribe(connectionId: string, listener: () => void): () => void {
    if (!connectionId) return () => {}
    const entry = getEntry(connectionId)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  },

  getSnapshot(connectionId: string): TransactionSnapshot {
    return connectionId ? getEntry(connectionId).snapshot : EMPTY
  },

  setMode(connectionId: string, mode: 'auto' | 'manual'): void {
    if (!connectionId) return
    const entry = getEntry(connectionId)
    // Do not switch to Auto while BEGIN or settlement is unresolved: the backend may
    // already own a transaction even when the response has not reached the UI yet.
    if (mode === 'auto' && (entry.snapshot.txOpen || entry.snapshot.txBusy)) return
    update(entry, { txMode: mode })
  },

  /** Apply the direct result of a connection mutation to an existing console store. */
  syncConnection(connection: DbConnectionInfo): void {
    const entry = entries.get(connection.id)
    // A reconnect/config mutation can overlap BEGIN/COMMIT. The transition response is
    // authoritative for its own boundary and will be followed by a guarded refresh.
    if (!entry || entry.transition) return
    applyConnection(entry, connection)
  },

  /** A disconnected/replaced driver cannot retain its old transaction. */
  markClosed(connectionId: string): void {
    const entry = entries.get(connectionId)
    if (entry) applyConnection(entry, undefined)
  },

  refresh,
  ensureOpen,
  settle,
}
