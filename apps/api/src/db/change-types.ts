import type { Generated } from 'kysely'

/** The change feed: one append-only row per notice (`features/changes`). */
export interface ChangeEventsTable {
  seq: Generated<number>
  /** Whose registry the notice belongs to: `core`, or `plugin:<name>`. */
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
