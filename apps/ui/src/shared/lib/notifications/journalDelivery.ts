import type {
  ClientJournalOp,
  InboxChange,
  InboxSyncResponse,
} from '@localixai/api/notification-contracts'

import {
  advanceJournalCursor,
  applyJournalChanges,
  applyJournalSync,
  applyOpToView,
  journalCursor,
} from './journal'
import { enqueueOp, nextBatch, settleOps } from './outbox'

/**
 * HOW THIS WINDOW AND THE SERVER JOURNAL TALK: catching up on connect, taking live changes, and
 * delivering this window's own ops. The copy they update is `journal.ts`; this module owns only
 * the connection's state, because every rule here is about WHEN a change may be trusted.
 *
 * - A live frame advances the cursor only once this connection's catch-up read has landed. Before
 *   that, frames are contiguous only from the moment the server subscribed us, and moving the
 *   cursor past a gap would skip, on the next reconnect, what the gap held.
 * - A catch-up read that outlives its connection still applies its rows (the seq rule keeps the
 *   newer of anything) but may not move the cursor for the next one.
 * - An op leaves the outbox only when the server answered it; a failed POST waits for the next
 *   connect, or a backoff timer while connected.
 */

export interface JournalTransport {
  sync(since: number): Promise<InboxSyncResponse>
  /** The changes the server made; `'rejected'` for a batch it will never accept. Throws to retry. */
  post(ops: readonly ClientJournalOp[]): Promise<InboxChange[] | 'rejected'>
}

const RETRY_MIN_MS = 2_000
const RETRY_MAX_MS = 60_000

let transport: JournalTransport | null = null
let online = false
/** Counts connects and drops, so a read that outlived its connection cannot vouch for the next. */
let connection = 0
let syncedConnection = false
/** The newest seq seen live on a connection whose catch-up read has not landed yet. */
let unsyncedLiveMax = 0
let flushing = false
let flushScheduled = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = RETRY_MIN_MS

/** One live change from the socket (`n` frame). */
export function applyLiveChange(change: InboxChange): void {
  if (syncedConnection) advanceJournalCursor(change.seq)
  else unsyncedLiveMax = Math.max(unsyncedLiveMax, change.seq)
  applyJournalChanges([change], { live: true })
}

async function resync(current: number): Promise<void> {
  if (!transport) return
  const since = journalCursor()
  let response = await transport.sync(since)
  // A cursor ahead of the server's means a different journal (a reset `~/.localix`): start over.
  if (!response.full && response.cursor < since) response = await transport.sync(0)
  if (current !== connection) return applyJournalChanges(response.changes, { live: false })
  applyJournalSync(response, unsyncedLiveMax)
  unsyncedLiveMax = 0
}

/** Make an op: visible now, delivered when the server can take it. */
export function submitOp(op: ClientJournalOp): void {
  enqueueOp(op)
  applyOpToView(op)
  if (flushScheduled) return
  flushScheduled = true
  // One flush per tick: a problem's raise and its settle travel in one batch.
  queueMicrotask(() => {
    flushScheduled = false
    void flushOutbox()
  })
}

function scheduleRetry(): void {
  if (retryTimer || !online) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flushOutbox()
  }, retryDelay)
  retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2)
}

async function flushOutbox(): Promise<void> {
  if (flushing || !online || !transport) return
  flushing = true
  try {
    for (let batch = nextBatch(); batch.length > 0 && online && transport; batch = nextBatch()) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- batches are ordered: a settle must land after the raise it settles
      const result = await transport.post(batch)
      // Out of the outbox in the same step the answer lands, so the row never flickers back.
      settleOps(new Set(batch.map((op) => op.id)))
      if (result === 'rejected') {
        console.warn('[notifications] the journal rejected a batch of ops; they were dropped')
      }
      applyJournalChanges(result === 'rejected' ? [] : result, { live: true })
    }
    retryDelay = RETRY_MIN_MS
  } catch {
    scheduleRetry()
  } finally {
    flushing = false
  }
}

export function attachJournalTransport(next: JournalTransport | null): void {
  transport = next
}

/** The socket is up: catch up on what was missed, then deliver what is waiting. */
export async function journalConnected(): Promise<void> {
  connection += 1
  const current = connection
  online = true
  syncedConnection = false
  retryDelay = RETRY_MIN_MS
  try {
    await resync(current)
    if (current === connection && online) syncedConnection = true
  } catch {
    // The next connect retries; live frames still apply meanwhile.
  }
  await flushOutbox()
}

export function journalDisconnected(): void {
  connection += 1
  online = false
  syncedConnection = false
  unsyncedLiveMax = 0
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
}

export function resetDeliveryForTests(): void {
  journalDisconnected()
  transport = null
}
