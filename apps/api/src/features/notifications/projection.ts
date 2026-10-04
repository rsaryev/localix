import type { NotificationEventKind } from '../../db/types'
import {
  BODY_MAX,
  COALESCE_WINDOW_MS,
  TITLE_MAX,
  type InboxAction,
  type InboxEntry,
  type RaiseFact,
  type SettleReason,
} from './contracts'

/**
 * THE INBOX'S RULES, as pure transitions: given the row a subject has now (or none) and a fact,
 * what the row becomes and which event records the change — or `null` when nothing changes.
 *
 * "Nothing changes" is the idempotency of the whole journal. A replayed lifecycle fact, a
 * republished condition that is still open, a read of a read row: none of them writes an event, so
 * a producer may record a fact as often as it likes and the journal still says it once.
 */

export interface Transition {
  entry: Omit<InboxEntry, 'seq'>
  kind: NotificationEventKind
}

const bounded = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

function freshEntry(fact: RaiseFact, now: number): Omit<InboxEntry, 'seq'> {
  const at = fact.occurredAt ?? now
  return {
    key: fact.key,
    topic: fact.topic,
    category: fact.category,
    severity: fact.severity,
    title: bounded(fact.title, TITLE_MAX),
    body: fact.body ? bounded(fact.body, BODY_MAX) : undefined,
    origin: fact.origin,
    actions: fact.actions?.length ? fact.actions : undefined,
    trace: fact.trace?.length ? fact.trace.slice(-12) : undefined,
    condition: fact.condition ?? false,
    state: 'open',
    occurrenceCount: 1,
    firstSeenAt: at,
    lastSeenAt: at,
    readAt: fact.seen ? now : undefined,
    createdAt: now,
  }
}

/**
 * Raise `fact` against the row its key already has.
 *
 * - no row: a new open row;
 * - an open row: unchanged — a replay, or a condition still true (its text is part of its key);
 * - a settled CONDITION: reopened on top, unread, one more occurrence — it came back;
 * - a settled lifecycle fact: unchanged — an answered request is not asked again by a replay.
 */
export function raise(
  existing: Omit<InboxEntry, 'seq'> | undefined,
  fact: RaiseFact,
  now: number,
): Transition | null {
  if (!existing) return { entry: freshEntry(fact, now), kind: 'raised' }
  if (existing.state === 'open' || !existing.condition || !(fact.condition ?? false)) return null
  const next = freshEntry(fact, now)
  return {
    kind: 'reopened',
    entry: {
      ...next,
      occurrenceCount: existing.occurrenceCount + 1,
      firstSeenAt: existing.firstSeenAt,
      createdAt: existing.createdAt,
    },
  }
}

/** Whether an anonymous repeat should fold into `candidate` rather than become its own row. */
export function isRepeatOf(
  candidate: Omit<InboxEntry, 'seq'>,
  fact: RaiseFact,
  now: number,
): boolean {
  const at = fact.occurredAt ?? now
  return (
    candidate.state === 'open' &&
    !candidate.condition &&
    candidate.topic === fact.topic &&
    candidate.category === fact.category &&
    candidate.severity === fact.severity &&
    candidate.title === bounded(fact.title, TITLE_MAX) &&
    (candidate.body ?? undefined) === (fact.body ? bounded(fact.body, BODY_MAX) : undefined) &&
    sameOriginScope(candidate.origin, fact.origin) &&
    at >= candidate.lastSeenAt &&
    at - candidate.lastSeenAt <= COALESCE_WINDOW_MS
  )
}

function sameOriginScope(left: InboxEntry['origin'], right: InboxEntry['origin']): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'application' || right.kind === 'application') return true
  return left.sessionId === right.sessionId && left.projectId === right.projectId
}

/** Fold a repeat into an existing row: one fact seen again, counted, and unread again if it was. */
export function repeat(
  existing: Omit<InboxEntry, 'seq'>,
  fact: RaiseFact,
  now: number,
): Transition {
  return {
    kind: 'repeated',
    entry: {
      ...existing,
      occurrenceCount: existing.occurrenceCount + 1,
      lastSeenAt: fact.occurredAt ?? now,
      readAt: fact.seen ? (existing.readAt ?? now) : undefined,
      actions: fact.actions?.length ? fact.actions : existing.actions,
      trace: fact.trace?.length ? fact.trace.slice(-12) : existing.trace,
    },
  }
}

const retire = (actions: InboxAction[] | undefined) =>
  actions?.map((action) => (action.available ? { ...action, available: false } : action))

/** Settle an open row: nothing it offers can act any more. A settled row is left as it is. */
export function settle(
  existing: Omit<InboxEntry, 'seq'>,
  reason: SettleReason,
  now: number,
): Transition | null {
  if (existing.state === 'settled') return null
  return {
    kind: 'settled',
    entry: {
      ...existing,
      state: 'settled',
      settleReason: reason,
      settledAt: now,
      actions: retire(existing.actions),
    },
  }
}

export function read(existing: Omit<InboxEntry, 'seq'>, now: number): Transition | null {
  if (existing.readAt != null) return null
  return { kind: 'read', entry: { ...existing, readAt: now } }
}

/**
 * Whether a row still stands for something open — work the person can do, or a problem that is
 * still true. "Clear history" keeps these, and retention evicts them last.
 */
export function isPending(entry: Omit<InboxEntry, 'seq'>): boolean {
  // A plain "Open chat" is not work: only a command, or a navigation that lands on a pending
  // interaction, keeps a row open. Otherwise every completed run would be "pending" forever.
  return (
    entry.state === 'open' &&
    (entry.condition ||
      (entry.actions ?? []).some(
        (action) =>
          action.available && (action.kind === 'invoke' || action.target?.focus === 'interaction'),
      ))
  )
}
