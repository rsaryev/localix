import { useSyncExternalStore } from 'react'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import type { DbConnectionInfo } from '../dbClient'
import { databaseApi } from '../api/databaseApi'
import { dbProblem } from '../problems'
import { copyNullRecord, createNullRecord, defineRecordValue } from '../../shared/safe-record'
import { DATABASE_CONNECTIONS } from './topics'

/**
 * The ONE copy of the saved-connection list in this mini app's UI.
 *
 * The defect it stops: three readers each fetched the same list on their own. The titlebar item
 * held a shared resource, every `useDbConnections` instance (the Database workspace, each
 * connection tab) kept private state and re-listed on EVERY visibility flip, and every open `.sql`
 * tab listed again on mount and on each window focus. Switching tabs cost a request per mounted
 * surface, and — worse — the copies disagreed: renaming or connecting in one tab left the
 * others, and the titlebar, showing the old row until their own next fetch.
 *
 * So the list lives here once, as an immutable snapshot behind `subscribe`/`getSnapshot` (the
 * `schemaStore` shape, read through `useSyncExternalStore`):
 *
 *   - a read is in-flight-deduped: every mount and focus while one is running joins it;
 *   - a read is owed once per process, not once per mount — a visibility flip reuses a fresh
 *     list, and a visible surface re-reads a stale one ({@link pollConnections}), because the
 *     agent's tool writes connections server-side where no UI call can announce them;
 *   - a change announced on `DATABASE_CONNECTIONS` (every mutating `databaseApi` call) or an
 *     explicit Retry re-reads, and a request made DURING a read queues exactly one trailing read,
 *     because the running one may have been answered before the change it is asked to reflect;
 *   - the mutations in `connectionsActions.ts` write the snapshot directly, so every reader sees
 *     a rename/connect/remove at once rather than at its next fetch.
 */
export interface ConnectionsSnapshot {
  connections: DbConnectionInfo[]
  /** True until the first read settles, and again while any read runs. An empty `connections`
   *  with `loading` means "still asking", never "you have none". */
  loading: boolean
  /** Why the list is missing or stale, when it is; `null` with an empty list means the server
   *  genuinely has none. */
  listError: Problem | null
  /** Ids currently being (re)established. */
  reconnecting: Record<string, boolean>
  /** Last reconnect failure per id; while set, auto-reconnect stands down for that id. */
  reconnectError: Record<string, Problem>
}

const initialSnapshot = (): ConnectionsSnapshot => ({
  connections: [],
  loading: true,
  listError: null,
  reconnecting: createNullRecord<boolean>(),
  reconnectError: createNullRecord<Problem>(),
})

let snapshot = initialSnapshot()
const listeners = new Set<() => void>()

/**
 * Per-id operation revisions. A list read captures them at its start; a row whose revision moved
 * while the read ran was changed locally (connect/rename/remove) after the server answered, so
 * the read's copy of that row is older than the one on screen and must not replace it.
 */
const operationRevision = new Map<string, number>()
/** Ids whose delete is in flight: terminal for that window — nothing may put the row back. */
export const removing = new Set<string>()
/** One shared reconnect per id: the de-dupe barrier AND the result every concurrent caller gets. */
export const reconnects = new Map<string, Promise<DbConnectionInfo | undefined>>()

let requested = false
let inFlight: Promise<void> | null = null
let trailing = false
/** Bumped by {@link resetConnectionsStore}, so a read begun before a reset commits nothing. */
let generation = 0

function commit(patch: Partial<ConnectionsSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of Array.from(listeners)) listener()
}

export function subscribeConnections(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getConnectionsSnapshot = (): ConnectionsSnapshot => snapshot

export function useConnectionsSnapshot(): ConnectionsSnapshot {
  return useSyncExternalStore(subscribeConnections, getConnectionsSnapshot, getConnectionsSnapshot)
}

export function revisionOf(id: string): number {
  return operationRevision.get(id) ?? 0
}

export function bumpOperation(id: string): number {
  const revision = revisionOf(id) + 1
  operationRevision.set(id, revision)
  return revision
}

export function updateConnections(next: (current: DbConnectionInfo[]) => DbConnectionInfo[]) {
  commit({ connections: next(snapshot.connections) })
}

export function setReconnecting(id: string, on: boolean): void {
  if (!on && !Object.hasOwn(snapshot.reconnecting, id)) return
  const next = copyNullRecord(snapshot.reconnecting)
  if (on) defineRecordValue(next, id, true)
  else delete next[id]
  commit({ reconnecting: next })
}

export function setReconnectError(id: string, problem: Problem | null): void {
  if (!problem && !Object.hasOwn(snapshot.reconnectError, id)) return
  const next = copyNullRecord(snapshot.reconnectError)
  if (problem) defineRecordValue(next, id, problem)
  else delete next[id]
  commit({ reconnectError: next })
}

/** Server answer merged with local writes that happened while it was on the wire. */
function mergeListed(
  current: DbConnectionInfo[],
  listed: DbConnectionInfo[],
  changedSinceStart: (id: string) => boolean,
): DbConnectionInfo[] {
  const currentById = new Map(current.map((connection) => [connection.id, connection]))
  const merged: DbConnectionInfo[] = []
  const seen = new Set<string>()
  for (const row of listed) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    if (!changedSinceStart(row.id)) {
      merged.push(row)
      continue
    }
    const local = currentById.get(row.id)
    if (local) merged.push(local)
  }
  // A connect/update may have created a row the server snapshot did not have yet.
  for (const local of current) {
    if (!seen.has(local.id) && changedSinceStart(local.id)) merged.push(local)
  }
  return merged
}

/** Row-for-row equal: an answer that moved nothing must not hand every reader a new array. */
const sameRows = (a: readonly DbConnectionInfo[], b: readonly DbConnectionInfo[]) =>
  a.length === b.length && a.every((row, i) => JSON.stringify(row) === JSON.stringify(b[i]))

/**
 * How often a VISIBLE workbench re-reads the list — a BACKSTOP, not how the agent's change arrives.
 *
 * The `database_client` tool connects, disconnects and removes on the server, and a list that only
 * re-read on the UI's own calls kept showing the empty "choose a database" screen after the agent
 * said it had added one. That change now arrives as a push: the tool emits `{ type: 'connections' }`
 * on the session stream (`shared/database-changes.ts`), a roster frame every chat's stream carries
 * and a reconnect replays, and `databaseChanges.ts` re-reads the list at once. Polling every 4 s on
 * top of it re-read the list ~900 times an hour per open workbench to learn nothing. What no frame
 * announces — another app window's own edit — is caught within this window.
 */
export const CONNECTIONS_POLL_MS = 60_000
let lastReadAt = 0

/** `quiet`: a poll — no `loading` flash and no cleared error before the answer is in. */
function read(quiet = false, at = Date.now()): Promise<void> {
  requested = true
  lastReadAt = at
  const owner = generation
  const revisionsAtStart = new Map(operationRevision)
  if (!quiet) commit({ loading: true, listError: null })
  const request = databaseApi
    .list()
    .then(
      (listed) => {
        if (owner !== generation) return
        const changed = (id: string) => revisionOf(id) !== (revisionsAtStart.get(id) ?? 0)
        const connections = mergeListed(snapshot.connections, listed, changed)
        if (!sameRows(snapshot.connections, connections)) commit({ connections })
        if (snapshot.listError) commit({ listError: null })
      },
      (err: unknown) => {
        // Recorded, not swallowed: an empty list is what the sidebar reads as "you have no
        // connections" and answers by opening the new-connection form. The last good rows stay.
        if (owner !== generation) return
        commit({ listError: dbProblem(err, 'Could not load your saved connections.') })
      },
    )
    .finally(() => {
      if (owner !== generation) return
      inFlight = null
      if (trailing) {
        trailing = false
        void read()
        return
      }
      if (snapshot.loading) commit({ loading: false })
    })
  inFlight = request
  return request
}

/** A reader mounted: list once per process; a later mount (or visibility flip) reuses it. */
export function ensureConnectionsListed(): void {
  if (!requested) void read()
}

/** A cheap "is it still true?" (window focus): joins a running read instead of queueing one. */
export function revalidateConnections(): void {
  if (!inFlight) void read()
}

/** Something changed (a Retry, an announced write): re-read, after the running read if any. */
export function refreshConnections(): void {
  if (inFlight) trailing = true
  else void read()
}

/**
 * A visible reader's poll tick ({@link CONNECTIONS_POLL_MS}). Every visible surface polls, so the
 * store — not the surface — decides: it joins a running read, and skips a tick that follows the
 * last read by less than half a window, so N open tabs still cost one request per window. Never
 * for a list nobody has asked for yet; the first read is `ensureConnectionsListed`'s.
 */
export function pollConnections(now = Date.now()): Promise<void> | undefined {
  if (!requested) return undefined
  if (inFlight) return inFlight
  if (now - lastReadAt < CONNECTIONS_POLL_MS / 2) return undefined
  return read(true, now)
}

// Only a list somebody asked for is re-read: announcing a change must not fetch for nobody.
DATABASE_CONNECTIONS.subscribe(() => {
  if (requested) refreshConnections()
})

/** Tests only: each case starts from a process that has never listed. */
export function resetConnectionsStore(): void {
  generation += 1
  requested = false
  inFlight = null
  trailing = false
  lastReadAt = 0
  operationRevision.clear()
  removing.clear()
  reconnects.clear()
  snapshot = initialSnapshot()
  for (const listener of Array.from(listeners)) listener()
}
