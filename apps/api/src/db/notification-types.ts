import type { ColumnType, Generated } from 'kysely'

// Row types of the notification journal (`migrations/20260924T120000_notification_journal.ts`).
// Owned by `features/notifications`; nothing else reads or writes these tables.

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null | undefined>

export type NotificationEventKind =
  | 'raised'
  | 'reopened'
  | 'repeated'
  | 'settled'
  | 'read'
  | 'removed'

/** Append-only: a row is written once and only ever deleted by retention. */
export interface NotificationEventsTable {
  seq: Generated<number>
  user_id: string
  subject_key: string
  kind: NotificationEventKind
  source: 'server' | 'client'
  payload_json: ColumnType<string, string | undefined, never>
  occurred_at: string
  recorded_at: ColumnType<string, string | undefined, never>
}

/** The projection: one row per (user, subject), rewritten by the event that changed it. */
export interface NotificationInboxTable {
  user_id: string
  subject_key: string
  last_seq: number
  topic: string
  category: 'human-input' | 'agent' | 'terminal' | 'system'
  severity: 'info' | 'success' | 'warning' | 'error'
  title: string
  body: Nullable<string>
  origin_json: string
  /** Denormalized from the origin so a session's rows are one index lookup. */
  session_id: Nullable<string>
  actions_json: Nullable<string>
  trace_json: Nullable<string>
  is_condition: number
  state: 'open' | 'settled'
  settle_reason: Nullable<string>
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  read_at: Nullable<string>
  settled_at: Nullable<string>
  created_at: string
}

/** "This client batch op was applied once" — what makes an outbox resend a no-op. */
export interface NotificationOpReceiptsTable {
  op_id: string
  user_id: string
  created_at: ColumnType<string, string | undefined, never>
}
