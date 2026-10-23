import type { ClientJournalOp } from '@localixai/api/notification-contracts'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

/**
 * THE DELIVERY BUFFER for ops this client has made and the server has not acknowledged.
 *
 * The facts most worth keeping are the ones that arrive while the API is unreachable — "the
 * realtime connection is down", "saving failed" — which is exactly when a POST cannot land. So an
 * op is kept here until the server answers it, and survives a reload in `localStorage`. This is
 * NOT a journal: nothing reads it back as history, it only holds what is still in transit, and
 * each op's `id` makes a resend after a lost answer a no-op on the server.
 */

const OUTBOX_STORAGE_KEY = 'localix_notification_outbox_v1'
/** Bounded like any buffer; past it the OLDEST ops go, since newer facts supersede older ones. */
const OUTBOX_CAP = 1_000
/** The server's batch limit (`clientJournalOpsSchema`). */
const OUTBOX_BATCH = 200

const OPS = new Set(['raise', 'settle', 'read', 'read_through', 'remove', 'clear'])

function isOp(value: unknown): value is ClientJournalOp {
  if (!value || typeof value !== 'object') return false
  const op = value as Record<string, unknown>
  return typeof op.id === 'string' && typeof op.op === 'string' && OPS.has(op.op)
}

/** A stored op is only checked for shape; the server validates the rest and rejects a bad batch. */
function load(): ClientJournalOp[] {
  const stored = loadJSON<unknown>(OUTBOX_STORAGE_KEY)
  return Array.isArray(stored) ? stored.filter(isOp).slice(-OUTBOX_CAP) : []
}

let pending: ClientJournalOp[] = load()
let persistScheduled = false
let opSequence = 0

function schedulePersist(): void {
  if (persistScheduled) return
  persistScheduled = true
  // One write per tick: a burst of ops (a problem raise and its settle) costs one serialization.
  queueMicrotask(() => {
    persistScheduled = false
    saveJSON(OUTBOX_STORAGE_KEY, pending.length ? pending : null)
  })
}

/** Unique across reloads and windows, which is what makes a resend safe. */
export function newOpId(): string {
  opSequence += 1
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `c${Date.now().toString(36)}-${opSequence.toString(36)}-${random}`.slice(0, 120)
}

export function pendingOps(): readonly ClientJournalOp[] {
  return pending
}

export function enqueueOp(op: ClientJournalOp): void {
  pending = [...pending, op].slice(-OUTBOX_CAP)
  schedulePersist()
}

export function nextBatch(): ClientJournalOp[] {
  return pending.slice(0, OUTBOX_BATCH)
}

/** The server answered these ops (or rejected them as malformed): they leave the buffer. */
export function settleOps(ids: ReadonlySet<string>): void {
  pending = pending.filter((op) => !ids.has(op.id))
  schedulePersist()
}

export function resetOutboxForTests(): void {
  pending = []
  saveJSON(OUTBOX_STORAGE_KEY, null)
}

/** Re-read the stored buffer, as a fresh page load would. */
export function reloadOutboxForTests(): void {
  pending = load()
}
