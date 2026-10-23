import type { Generated, Kysely, Transaction } from 'kysely'

/** The change feed: one append-only row per notice. */
export interface ChangeEventsTable {
  seq: Generated<number>
  /** Whose registry the notice belongs to: `core`, or `mini-app:<name>`. */
  stream: string
  entity: string
  op: 'upserted' | 'deleted' | 'resync'
  /** The entity's ref as JSON; null for `resync`. */
  ref_json: string | null
  recorded_at: Generated<string>
}

/** How far each consumer has read its stream. */
export interface ChangeCursorsTable {
  consumer: string
  stream: string
  seq: number
  updated_at: string
}

/** A notice a consumer gave up on after every attempt, kept until it is replayed. */
export interface ChangeDeadLettersTable {
  consumer: string
  stream: string
  seq: number
  entity: string
  op: string
  ref_json: string | null
  error: string
  failed_at: string
}

/** The tables the feed reads and writes; an application database includes them. */
export interface ChangeFeedTables {
  change_events: ChangeEventsTable
  change_cursors: ChangeCursorsTable
  change_dead_letters: ChangeDeadLettersTable
}

/** Any database, or open transaction, that has the feed's tables. */
export type ChangeFeedWriter<DB extends ChangeFeedTables = ChangeFeedTables> =
  | Kysely<DB>
  | Transaction<DB>

/** Narrow an application database to the feed's own tables. */
export const feedTables = <DB extends ChangeFeedTables>(db: ChangeFeedWriter<DB>) =>
  db as unknown as Kysely<ChangeFeedTables>
