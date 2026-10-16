import type { ClientJournalOp, RaiseFact } from '@localixai/api/notification-contracts'

import { retainActionableEvents } from './actionability'
import {
  addEntry,
  markAllRead,
  markRead,
  removeEntry,
  resolveByIdPrefix,
  settleEntry,
} from './core'
import type { NotificationEntry } from './types'

/**
 * What an op the server has not answered yet does to the rows on screen.
 *
 * The rendered list is always `server rows + every pending op, replayed` (`journal.ts`). That is
 * what makes an op's effect visible the moment it is made — including the one case the journal
 * exists for and the API cannot serve: a fact about the API being unreachable — and what makes it
 * disappear exactly when the server's answer (which already contains it) arrives, with no per-row
 * bookkeeping to go stale.
 */

function provisionalEntry(fact: RaiseFact, now: number): NotificationEntry {
  const at = fact.occurredAt ?? now
  return {
    id: fact.key,
    topic: fact.topic,
    category: fact.category,
    severity: fact.severity,
    title: fact.title,
    message: fact.body,
    origin: fact.origin,
    actions: fact.actions?.map((action) => ({ ...action })),
    trace: fact.trace,
    condition: fact.condition ?? false,
    occurrenceCount: 1,
    firstSeenAt: at,
    lastSeenAt: at,
    ts: at,
    read: fact.seen ?? false,
  }
}

interface OptimisticContext {
  /** The journal position of each row the server has confirmed; `read_through` reads by it. */
  seqOf: (key: string) => number | undefined
  now: number
}

export function applyOpLocally(
  list: readonly NotificationEntry[],
  op: ClientJournalOp,
  context: OptimisticContext,
): NotificationEntry[] {
  switch (op.op) {
    case 'raise':
      return addEntry(list, provisionalEntry(op.fact, context.now), Number.POSITIVE_INFINITY)
    case 'settle': {
      const at = op.fact.occurredAt ?? context.now
      return op.fact.key
        ? settleEntry(list, op.fact.key, at)
        : resolveByIdPrefix(list, op.fact.prefix ?? '', op.fact.keep, at)
    }
    case 'read':
      return op.keys.reduce((next, key) => markRead(next, key), list as NotificationEntry[])
    case 'read_through': {
      const covered = list.filter((entry) => (context.seqOf(entry.id) ?? Infinity) <= op.seq)
      if (covered.length === list.length) return markAllRead(list)
      return covered.reduce((next, entry) => markRead(next, entry.id), list as NotificationEntry[])
    }
    case 'remove':
      return removeEntry(list, op.key)
    case 'clear':
      return retainActionableEvents(list)
  }
}
