import type { Kysely, Transaction } from 'kysely'

import type { AppDatabase, NotificationInboxTable } from '../../db/types'
import type { InboxChange, InboxEntry, InboxSyncResponse } from './contracts'
import type { Transition } from './projection'

/**
 * The journal's storage: every change is an `notification_events` row AND the rewritten
 * `notification_inbox` row it produced, in one transaction, so the projection can never disagree
 * with the log it was built from. Nothing outside `features/notifications` touches these tables.
 */

type Db = Kysely<AppDatabase> | Transaction<AppDatabase>
type Row = NotificationInboxTable extends infer T ? { [K in keyof T]: unknown } : never
type EntryBody = Omit<InboxEntry, 'seq'>

const iso = (ms: number) => new Date(ms).toISOString()
const ms = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : undefined)

function parse<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

export function toEntry(row: Record<string, unknown>): InboxEntry {
  return {
    key: row.subject_key as string,
    seq: row.last_seq as number,
    topic: row.topic as InboxEntry['topic'],
    category: row.category as InboxEntry['category'],
    severity: row.severity as InboxEntry['severity'],
    title: row.title as string,
    body: (row.body as string | null) ?? undefined,
    origin: parse<InboxEntry['origin']>(row.origin_json) ?? { kind: 'application' },
    actions: parse<InboxEntry['actions']>(row.actions_json),
    trace: parse<InboxEntry['trace']>(row.trace_json),
    condition: row.is_condition === 1,
    state: row.state as InboxEntry['state'],
    settleReason: (row.settle_reason as InboxEntry['settleReason'] | null) ?? undefined,
    occurrenceCount: row.occurrence_count as number,
    firstSeenAt: ms(row.first_seen_at)!,
    lastSeenAt: ms(row.last_seen_at)!,
    readAt: ms(row.read_at),
    settledAt: ms(row.settled_at),
    createdAt: ms(row.created_at)!,
  }
}

function toRow(userId: string, entry: EntryBody, seq: number) {
  const origin = entry.origin
  return {
    user_id: userId,
    subject_key: entry.key,
    last_seq: seq,
    topic: entry.topic,
    category: entry.category,
    severity: entry.severity,
    title: entry.title,
    body: entry.body ?? null,
    origin_json: JSON.stringify(origin),
    session_id: origin.kind === 'application' ? null : origin.sessionId,
    actions_json: entry.actions?.length ? JSON.stringify(entry.actions) : null,
    trace_json: entry.trace?.length ? JSON.stringify(entry.trace) : null,
    is_condition: entry.condition ? 1 : 0,
    state: entry.state,
    settle_reason: entry.settleReason ?? null,
    occurrence_count: entry.occurrenceCount,
    first_seen_at: iso(entry.firstSeenAt),
    last_seen_at: iso(entry.lastSeenAt),
    read_at: entry.readAt != null ? iso(entry.readAt) : null,
    settled_at: entry.settledAt != null ? iso(entry.settledAt) : null,
    created_at: iso(entry.createdAt),
  } satisfies Row
}

export function createNotificationRepository(db: Kysely<AppDatabase>) {
  return {
    transaction<T>(run: (trx: Transaction<AppDatabase>) => Promise<T>): Promise<T> {
      return db.transaction().execute(run)
    },

    async get(trx: Db, userId: string, key: string): Promise<InboxEntry | undefined> {
      const row = await trx
        .selectFrom('notification_inbox')
        .selectAll()
        .where('user_id', '=', userId)
        .where('subject_key', '=', key)
        .executeTakeFirst()
      return row ? toEntry(row) : undefined
    },

    /** Open, non-condition rows with this exact title — the only ones a repeat can fold into. */
    async repeatCandidates(trx: Db, userId: string, title: string): Promise<InboxEntry[]> {
      const rows = await trx
        .selectFrom('notification_inbox')
        .selectAll()
        .where('user_id', '=', userId)
        .where('state', '=', 'open')
        .where('is_condition', '=', 0)
        .where('title', '=', title)
        .orderBy('last_seq', 'desc')
        .limit(8)
        .execute()
      return rows.map(toEntry)
    },

    async openUnderPrefix(trx: Db, userId: string, prefix: string): Promise<InboxEntry[]> {
      const rows = await trx
        .selectFrom('notification_inbox')
        .selectAll()
        .where('user_id', '=', userId)
        .where('state', '=', 'open')
        // `substr` equality, not LIKE: a key may contain `%` or `_`.
        .where((eb) =>
          eb(eb.fn('substr', ['subject_key', eb.lit(1), eb.lit(prefix.length)]), '=', prefix),
        )
        .execute()
      return rows.map(toEntry)
    },

    async all(trx: Db, userId: string): Promise<InboxEntry[]> {
      const rows = await trx
        .selectFrom('notification_inbox')
        .selectAll()
        .where('user_id', '=', userId)
        .execute()
      return rows.map(toEntry)
    },

    /** Record one transition: its event first (for the seq), then the row it produced. */
    async write(
      trx: Db,
      userId: string,
      source: 'server' | 'client',
      transition: Transition,
      payload: unknown,
      occurredAt: number,
    ): Promise<InboxChange> {
      const { seq } = await trx
        .insertInto('notification_events')
        .values({
          user_id: userId,
          subject_key: transition.entry.key,
          kind: transition.kind,
          source,
          payload_json: JSON.stringify(payload ?? {}),
          occurred_at: iso(occurredAt),
        })
        .returning('seq')
        .executeTakeFirstOrThrow()
      const row = toRow(userId, transition.entry, seq)
      await trx
        .insertInto('notification_inbox')
        .values(row)
        .onConflict((oc) => oc.columns(['user_id', 'subject_key']).doUpdateSet(row))
        .execute()
      return { seq, entry: { ...transition.entry, seq } }
    },

    async remove(
      trx: Db,
      userId: string,
      source: 'server' | 'client',
      key: string,
      occurredAt: number,
    ): Promise<InboxChange | null> {
      const deleted = await trx
        .deleteFrom('notification_inbox')
        .where('user_id', '=', userId)
        .where('subject_key', '=', key)
        .executeTakeFirst()
      if (Number(deleted.numDeletedRows) === 0) return null
      const { seq } = await trx
        .insertInto('notification_events')
        .values({
          user_id: userId,
          subject_key: key,
          kind: 'removed',
          source,
          occurred_at: iso(occurredAt),
        })
        .returning('seq')
        .executeTakeFirstOrThrow()
      return { seq, removedKey: key }
    },

    /** True the first time an op id is seen for this user; false for a resend. */
    async claimOp(trx: Db, userId: string, opId: string): Promise<boolean> {
      // RETURNING, not the insert count: this dialect leaves `numInsertedRows` unset, and SQLite
      // returns no row when ON CONFLICT DO NOTHING skipped the insert.
      const inserted = await trx
        .insertInto('notification_op_receipts')
        .values({ user_id: userId, op_id: opId })
        .onConflict((oc) => oc.doNothing())
        .returning('op_id')
        .executeTakeFirst()
      return inserted !== undefined
    },

    /**
     * Everything that changed after `since`, or the whole inbox when `since` is 0 or older than
     * the journal still remembers (`floor`).
     */
    async sync(userId: string, since: number): Promise<InboxSyncResponse> {
      const bounds = await db
        .selectFrom('notification_events')
        .select((eb) => [eb.fn.min('seq').as('floor'), eb.fn.max('seq').as('cursor')])
        .where('user_id', '=', userId)
        .executeTakeFirst()
      const floor = Number(bounds?.floor ?? 0)
      const cursor = Number(bounds?.cursor ?? 0)
      const full = since <= 0 || since < floor - 1
      const rows = await db
        .selectFrom('notification_inbox')
        .selectAll()
        .where('user_id', '=', userId)
        .$if(!full, (qb) => qb.where('last_seq', '>', since))
        .orderBy('last_seq', 'asc')
        .execute()
      const changes: InboxChange[] = rows.map((row) => ({ seq: row.last_seq, entry: toEntry(row) }))
      if (!full) {
        const removed = await db
          .selectFrom('notification_events')
          .select(['seq', 'subject_key'])
          .where('user_id', '=', userId)
          .where('kind', '=', 'removed')
          .where('seq', '>', since)
          .execute()
        for (const event of removed) changes.push({ seq: event.seq, removedKey: event.subject_key })
        changes.sort((left, right) => left.seq - right.seq)
      }
      return { changes, cursor, floor, full }
    },
  }
}

export type NotificationRepository = ReturnType<typeof createNotificationRepository>
