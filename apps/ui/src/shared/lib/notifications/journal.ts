import type {
  ClientJournalOp,
  InboxChange,
  InboxSyncResponse,
} from '@localixai/api/notification-contracts'

import { NOTIFICATIONS_CAP, trimToCap } from './core'
import { entryFromInbox } from './inboxMapping'
import { applyOpLocally } from './optimistic'
import { pendingOps } from './outbox'
import { dropOverlay, onOverlayExpired, withOverlay } from './overlay'
import type { NotificationEntry } from './types'

/**
 * THIS WINDOW'S COPY OF THE SERVER INBOX — a projection cache, never a source of truth.
 *
 * The Event Center used to own its history in `localStorage`, derived from stream frames: a closed
 * window learned nothing, two windows disagreed, and the record lived outside `~/.localix`. The
 * journal is the server's now (`apps/api/src/features/notifications`), and this module only keeps
 * what it last said, in three layers that each have one job:
 *
 *   rows      what the server confirmed, one per key, each at the highest `seq` seen for it;
 *   pending   ops made here and not yet answered (`outbox.ts`), replayed on top (`optimistic.ts`);
 *   overlay   this window's callbacks, merged in last (`overlay.ts`).
 *
 * The order matters for correctness, not taste. A change is applied only if its `seq` is newer than
 * the key's, so a socket frame and a sync response carrying the same change — which happens on
 * every reconnect — apply once, in either order. When changes arrive is `journalDelivery.ts`'s.
 */

const rows = new Map<string, NotificationEntry>()
const seqs = new Map<string, number>()
let cursor = 0
/** Set by the first catch-up read; until then nothing can tell a new row from an unseen one. */
let hydrated = false
let base: NotificationEntry[] = []

const projectionListeners = new Set<(entries: NotificationEntry[]) => void>()
const liveRaiseListeners = new Set<(entry: NotificationEntry) => void>()

/** The rows as rendered; capped like the list always was (`NotificationCenter.bound.dom.test`). */
export function journalEntries(): NotificationEntry[] {
  return trimToCap(base.map(withOverlay), NOTIFICATIONS_CAP)
}

/** Re-render with the current overlay (a producer replaced a row's callbacks). */
export function refreshJournalView(): void {
  const entries = journalEntries()
  for (const listener of projectionListeners) listener(entries)
}

function serverOrder(): NotificationEntry[] {
  return [...rows.values()].sort(
    (left, right) =>
      (right.lastSeenAt ?? right.ts) - (left.lastSeenAt ?? left.ts) ||
      (seqs.get(right.id) ?? 0) - (seqs.get(left.id) ?? 0),
  )
}

const seqOf = (key: string) => seqs.get(key)

function rebuild(): void {
  const context = { seqOf, now: Date.now() }
  base = pendingOps().reduce((list, op) => applyOpLocally(list, op, context), serverOrder())
  refreshJournalView()
}

onOverlayExpired(refreshJournalView)
// Ops still in transit from before a reload are on screen from the first paint, not after sync.
rebuild()

/** Apply server changes to `rows`; returns the rows that became OPEN by them. */
function ingest(changes: readonly InboxChange[]): NotificationEntry[] {
  const opened: NotificationEntry[] = []
  for (const change of changes) {
    const key = 'entry' in change ? change.entry.key : change.removedKey
    if (change.seq <= (seqs.get(key) ?? 0)) continue
    seqs.set(key, change.seq)
    const previous = rows.get(key)
    if (!('entry' in change)) {
      rows.delete(key)
      dropOverlay(key)
      continue
    }
    const next = entryFromInbox(change.entry)
    rows.set(key, next)
    if (next.resolvedAt != null) dropOverlay(key)
    else if ((!previous || previous.resolvedAt != null) && !next.read) opened.push(next)
  }
  return opened
}

/**
 * Changes from the socket or an op's answer. `live` ones may interrupt (`interruption.ts`) for a
 * row they OPEN; a catch-up read never does — it is what happened while nobody was listening.
 */
export function applyJournalChanges(
  changes: readonly InboxChange[],
  options: { live: boolean },
): void {
  const opened = ingest(changes)
  rebuild()
  if (!options.live || !hydrated) return
  for (const entry of opened) for (const listener of liveRaiseListeners) listener(entry)
}

/**
 * A catch-up read. A FULL one replaces the copy — except what arrived live after its snapshot was
 * taken: a key newer than the snapshot's own version of it, or than the snapshot itself.
 */
export function applyJournalSync(response: InboxSyncResponse, liveMax: number): void {
  if (response.full) {
    const snapshot = new Map(
      response.changes.map((item) => [
        'entry' in item ? item.entry.key : item.removedKey,
        item.seq,
      ]),
    )
    const newer = [...seqs].filter(([key, seq]) => seq > (snapshot.get(key) ?? response.cursor))
    const kept = new Map(newer.map(([key]) => [key, rows.get(key)]))
    rows.clear()
    seqs.clear()
    ingest(response.changes)
    for (const [key, seq] of newer) {
      seqs.set(key, seq)
      const row = kept.get(key)
      if (row) rows.set(key, row)
      else rows.delete(key)
    }
  } else {
    ingest(response.changes)
  }
  cursor = Math.max(response.cursor, liveMax)
  hydrated = true
  rebuild()
}

/** Paint an op the moment it is made; its answer replaces it (`journalDelivery.ts`). */
export function applyOpToView(op: ClientJournalOp): void {
  base = applyOpLocally(base, op, { seqOf, now: Date.now() })
  refreshJournalView()
}

export function advanceJournalCursor(seq: number): void {
  cursor = Math.max(cursor, seq)
}

export function journalCursor(): number {
  return cursor
}

export function journalSeqOf(key: string): number | undefined {
  return seqs.get(key)
}

export function onJournalProjection(listener: (entries: NotificationEntry[]) => void): () => void {
  projectionListeners.add(listener)
  return () => projectionListeners.delete(listener)
}

/** A row that became open by a change delivered while this window was live. */
export function onLiveRaise(listener: (entry: NotificationEntry) => void): () => void {
  liveRaiseListeners.add(listener)
  return () => liveRaiseListeners.delete(listener)
}

/** Rows as though the server had confirmed them, newest first, for rendering tests. */
export function seedJournalForTests(entries: readonly NotificationEntry[]): void {
  entries.forEach((entry, index) => {
    rows.set(entry.id, entry)
    seqs.set(entry.id, cursor + entries.length - index)
  })
  cursor += entries.length
  hydrated = true
  rebuild()
}

export function resetJournalForTests(): void {
  rows.clear()
  seqs.clear()
  cursor = 0
  hydrated = false
  liveRaiseListeners.clear()
  rebuild()
}
