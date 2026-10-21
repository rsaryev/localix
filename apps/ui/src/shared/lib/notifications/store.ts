import { create } from 'zustand'
import type { SettleReason } from '@localixai/api/notification-contracts'

import { unreadCount as unreadCountCore } from './core'
import { factFromEntry } from './inboxMapping'
import {
  journalCursor,
  journalEntries,
  journalSeqOf,
  onJournalProjection,
  resetJournalForTests,
  seedJournalForTests,
} from './journal'
import { resetDeliveryForTests, submitOp } from './journalDelivery'
import { newOpId, resetOutboxForTests } from './outbox'
import { resetOverlaysForTests, setDeliveryHint, setOverlay, type DeliveryHint } from './overlay'
import { sanitizeNotificationEntry } from './sanitize'
import type { NotificationEntry, NotificationInput } from './types'

/**
 * The Event Center's React surface over the client journal (`journal.ts`).
 *
 * `entries` is what the server inbox says plus what this window has done and the server has not
 * answered yet. Every mutator is therefore two things at once: an optimistic change the person
 * sees immediately, and an op sent to the server — which is what makes "mark read" in one window
 * mark it read in every other, and what makes a problem recorded here survive the window closing.
 */

interface NotificationsState {
  entries: NotificationEntry[]
  /** Raise a fact only this client knows; returns its journal key. */
  push: (input: NotificationInput, options?: PushOptions) => string
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clearHistory: () => void
  /** Settle one row: it is over (answered, retried, superseded). */
  settle: (id: string, reason: SettleReason) => void
  /** Settle standing-condition rows under a key prefix, keeping the one still true. */
  resolveCondition: (prefix: string, keep?: string) => void
}

export interface PushOptions {
  /** An anonymous event with a per-invocation key: an identical repeat folds into one row. */
  coalesce?: boolean
  /** How this fact wants to be delivered in this window (`interruption.ts`). */
  hint?: DeliveryHint
}

let keySequence = 0
function newKey(): string {
  keySequence += 1
  // Unique across reloads too: a key reused by a later fact would read as a replay of the first.
  const random = Math.random().toString(36).slice(2, 10)
  return `application.notification:${Date.now().toString(36)}:${keySequence.toString(36)}:${random}`
}

export const useNotificationsStore = create<NotificationsState>(() => ({
  entries: journalEntries(),
  push: (input, options = {}) => {
    const occurredAt = input.ts ?? Date.now()
    const entry = sanitizeNotificationEntry({
      ...input,
      id: input.id ?? newKey(),
      ts: occurredAt,
      read: input.read ?? false,
    })
    // Callbacks first: the raise below renders at once, and must render WITH them.
    setOverlay(entry.id, entry.actions ?? [])
    if (options.hint) setDeliveryHint(entry.id, options.hint)
    submitOp({
      id: newOpId(),
      op: 'raise',
      fact: factFromEntry(entry, { coalesce: options.coalesce, occurredAt }),
    })
    if (input.resolvedAt != null) {
      submitOp({
        id: newOpId(),
        op: 'settle',
        fact: { key: entry.id, reason: 'completed', occurredAt: input.resolvedAt },
      })
    }
    return entry.id
  },
  markRead: (id) => {
    const entry = useNotificationsStore.getState().entries.find((candidate) => candidate.id === id)
    if (!entry || entry.read) return
    submitOp({ id: newOpId(), op: 'read', keys: [id] })
  },
  markAllRead: () => {
    const unread = useNotificationsStore.getState().entries.filter((entry) => !entry.read)
    if (unread.length === 0) return
    // `read_through` covers every row the server has shown this window; a row still in transit
    // has no position yet and is named instead.
    const through = journalCursor()
    if (through > 0) submitOp({ id: newOpId(), op: 'read_through', seq: through })
    const unplaced: string[] = []
    for (const entry of unread) {
      if ((journalSeqOf(entry.id) ?? Infinity) > through) unplaced.push(entry.id)
    }
    for (let at = 0; at < unplaced.length; at += 500) {
      submitOp({ id: newOpId(), op: 'read', keys: unplaced.slice(at, at + 500) })
    }
  },
  remove: (id) => submitOp({ id: newOpId(), op: 'remove', key: id }),
  clearHistory: () => submitOp({ id: newOpId(), op: 'clear' }),
  settle: (id, reason) =>
    submitOp({ id: newOpId(), op: 'settle', fact: { key: id, reason, occurredAt: Date.now() } }),
  resolveCondition: (prefix, keep) =>
    submitOp({
      id: newOpId(),
      op: 'settle',
      fact: { prefix, ...(keep ? { keep } : {}), reason: 'fixed', occurredAt: Date.now() },
    }),
}))

onJournalProjection((entries) => useNotificationsStore.setState({ entries }))

// No dock badge from here. This store used to mirror its unread count onto the native app-icon
// badge while the chat mirrored its waiting conversations onto the SAME badge, so the number
// meant whichever writer ran last. The badge now has one writer and one meaning — conversations
// waiting on the person (`entities/chat/model/useDockBadge.ts`); unread history stays on the bell.

/** Non-React accessor for settling superseded or cleared standing conditions. */
export function resolveNotificationCondition(prefix: string, keep?: string): void {
  useNotificationsStore.getState().resolveCondition(prefix, keep)
}

/** Explicit full reset for isolated tests: no rows, no ops in transit, no transport. */
export function resetNotificationsForTests(): void {
  resetDeliveryForTests()
  resetOutboxForTests()
  resetOverlaysForTests()
  resetJournalForTests()
}

/** Rows as the server would report them, for tests that render a given journal. */
export function seedNotificationsForTests(inputs: readonly NotificationInput[]): void {
  seedJournalForTests(
    inputs.map((input, index) =>
      sanitizeNotificationEntry({
        ...input,
        id: input.id ?? `seed-${index}`,
        ts: input.ts ?? Date.now(),
        read: input.read ?? false,
      }),
    ),
  )
}

/** Selector: number of unread entries (for the bell badge). */
export function selectUnreadCount(s: NotificationsState): number {
  return unreadCountCore(s.entries)
}
