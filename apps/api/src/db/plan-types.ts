import type { ColumnType } from 'kysely'

// Row types for the conversation's plan and the comments on it, in their own module for size;
// `types.ts` re-exports them so every importer keeps taking table types from one place.

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null | undefined>

/**
 * One VERSION of a plan the agent presented for review (`features/plans`). Keyed to the ROOT
 * session, whose permission mode an approval changes; deleted with it.
 */
export interface SessionPlansTable {
  id: string
  user_id: string
  session_id: string
  /** 1.. per session, never reused. */
  version: number
  status: 'presented' | 'approved' | 'superseded' | 'dismissed' | 'completed'
  title: string
  /** Markdown, capped at ingress. */
  body: string
  /** The permission mode the approval switched the conversation to. */
  approved_mode: Nullable<string>
  /** Review rounds sent so far — the `<n>` of the round's once-ever delivery key. */
  review_round: ColumnType<number, number | undefined, number>
  created_at: string
  decided_at: Nullable<string>
  /** When the implementing agent declared the approved plan done, and what it said. */
  completed_at: Nullable<string>
  completion_summary: Nullable<string>
  /** Who set a `dismissed` version aside: the person, or leaving Plan mode (auto-restored). */
  dismissed_by: Nullable<'person' | 'mode'>
  /** 1 while the version waits on the person: presented or restored, and no review sent since. */
  awaiting_person: ColumnType<number, number | undefined, number>
}

/**
 * A person's comment on something the server only names by `scope` (`features/comments`); a
 * plan's are `plan:<id>` and are deleted with the plan. The anchor is the client's to read.
 */
export interface CommentsTable {
  id: string
  user_id: string
  scope: string
  anchor_json: string
  body: string
  status: 'open' | 'sent' | 'outdated'
  created_at: string
  updated_at: string
}
