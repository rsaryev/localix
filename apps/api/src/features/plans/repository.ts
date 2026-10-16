/**
 * Durable storage for plan versions. Each transition is ONE guarded write: the status it moves
 * from is part of the statement, so two tabs deciding the same version cannot both win, and the
 * loser hears `null`/`false` instead of overwriting the winner.
 *
 * INVARIANT: `awaiting_person = 1` only on a `presented` version with no review pending. It was
 * set on present and restore and cleared only when a review was delivered, so an approved version
 * kept `awaiting_person = 1`: harmless while the boot rebuild also filtered on
 * `presented`, and wrong for any reader that trusted the flag alone. So every write that moves a
 * version OUT of `presented` — approve, dismiss, supersede, complete — clears it in the same
 * statement (`LEFT_PRESENTED`).
 */
import { randomUUID } from 'node:crypto'
import type { Kysely, Selectable } from 'kysely'

import type { AppDatabase, SessionPlansTable } from '../../db/types'
import { parsePermissionMode } from '../capabilities/permission-modes'
import type {
  ImplementationMode,
  PlanDismissedBy,
  PlanDraft,
  PlanRecord,
  PlanStatus,
} from './contracts'

function toRecord(row: Selectable<SessionPlansTable>): PlanRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    version: row.version,
    status: row.status,
    title: row.title,
    body: row.body,
    authorAgentId: row.author_agent_id,
    approvedMode: row.approved_mode === null ? null : parsePermissionMode(row.approved_mode),
    reviewRound: row.review_round,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    completedAt: row.completed_at ?? null,
    completionSummary: row.completion_summary ?? null,
    dismissedBy: row.dismissed_by ?? null,
  }
}

export interface PlanOwner {
  userId: string
  /** The ROOT session. */
  sessionId: string
}

export interface PlanRepository {
  /**
   * Write the next version and supersede the one still waiting, together: a conversation never
   * has two plans presented at once, and the numbers are never reused.
   */
  present(
    owner: PlanOwner,
    authorAgentId: string,
    draft: PlanDraft,
    at: string,
  ): Promise<PlanRecord>
  /** Every version, newest first. */
  list(owner: PlanOwner): Promise<PlanRecord[]>
  /** One version, when it is the caller's. */
  get(userId: string, planId: string): Promise<PlanRecord | null>
  /** The version the person approved, if any — what later runs are told to follow. */
  approved(owner: PlanOwner): Promise<PlanRecord | null>
  /**
   * Approve a version that is presented or superseded; any other presented or approved version
   * of the conversation becomes superseded. Null when the version was decided meanwhile.
   */
  approve(planId: string, mode: ImplementationMode, at: string): Promise<PlanRecord | null>
  /** The version waiting for the person, if any — at most one per conversation. */
  presented(owner: PlanOwner): Promise<PlanRecord | null>
  /** Put a presented or approved version aside. Null when it was neither any more. */
  dismiss(planId: string, at: string, by: PlanDismissedBy): Promise<PlanRecord | null>
  /**
   * Bring a dismissed or superseded version back to `presented` — the same number, since the
   * person is reviewing the same text — and supersede any other version still presented. Null
   * when the version was in neither state any more.
   */
  restore(planId: string, at: string): Promise<PlanRecord | null>
  /** The approved version is done. Null when it was not approved any more. */
  complete(planId: string, summary: string, at: string): Promise<PlanRecord | null>
  /** Count one more review round of a presented version and answer its number. */
  nextReviewRound(planId: string): Promise<number | null>
  /**
   * A review reached the agent: the version stops waiting on the person, since the next move is
   * the agent's revision. Separate from counting the round, because a round whose wake was not
   * delivered leaves the version waiting — its comments went back on it.
   */
  reviewDelivered(planId: string): Promise<void>
  /**
   * Every version, across users, that waits on the person: presented or restored, and no review
   * sent back since. What a boot rebuilds attention from. Read from `awaiting_person`, not from
   * `review_round = 0`: a version restored after a review round keeps its count (each round's
   * delivery key stays unique), and the old rule left it out of attention after a restart.
   */
  listAwaitingReview(): Promise<PlanRecord[]>
}

const DECIDABLE: PlanStatus[] = ['presented', 'superseded']

/** Spread into every write that moves a version out of `presented`: nothing waits on the person. */
const LEFT_PRESENTED = { awaiting_person: 0 } as const

export function createPlanRepository(db: Kysely<AppDatabase>): PlanRepository {
  return {
    async present(owner, authorAgentId, draft, at) {
      return db.transaction().execute(async (trx) => {
        const top = await trx
          .selectFrom('session_plans')
          .select((eb) => eb.fn.max('version').as('version'))
          .where('session_id', '=', owner.sessionId)
          .executeTakeFirst()
        await trx
          .updateTable('session_plans')
          .set({ status: 'superseded', decided_at: at, ...LEFT_PRESENTED })
          .where('session_id', '=', owner.sessionId)
          .where('status', '=', 'presented')
          .execute()
        const row = await trx
          .insertInto('session_plans')
          .values({
            id: randomUUID(),
            user_id: owner.userId,
            session_id: owner.sessionId,
            version: Number(top?.version ?? 0) + 1,
            status: 'presented',
            title: draft.title,
            body: draft.body,
            author_agent_id: authorAgentId,
            approved_mode: null,
            created_at: at,
            decided_at: null,
            awaiting_person: 1,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
        return toRecord(row)
      })
    },

    async list(owner) {
      const rows = await db
        .selectFrom('session_plans')
        .selectAll()
        .where('user_id', '=', owner.userId)
        .where('session_id', '=', owner.sessionId)
        .orderBy('version', 'desc')
        .execute()
      return rows.map(toRecord)
    },

    async get(userId, planId) {
      const row = await db
        .selectFrom('session_plans')
        .selectAll()
        .where('id', '=', planId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async approved(owner) {
      const row = await db
        .selectFrom('session_plans')
        .selectAll()
        .where('user_id', '=', owner.userId)
        .where('session_id', '=', owner.sessionId)
        .where('status', '=', 'approved')
        .orderBy('version', 'desc')
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async approve(planId, mode, at) {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable('session_plans')
          .set({ status: 'approved', approved_mode: mode, decided_at: at, ...LEFT_PRESENTED })
          .where('id', '=', planId)
          .where('status', 'in', DECIDABLE)
          .returningAll()
          .executeTakeFirst()
        if (!row) return null
        await trx
          .updateTable('session_plans')
          .set({ status: 'superseded', decided_at: at, ...LEFT_PRESENTED })
          .where('session_id', '=', row.session_id)
          .where('id', '!=', planId)
          .where('status', 'in', ['presented', 'approved'])
          .execute()
        return toRecord(row)
      })
    },

    async restore(planId, at) {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable('session_plans')
          .set({ status: 'presented', decided_at: null, dismissed_by: null, awaiting_person: 1 })
          .where('id', '=', planId)
          .where('status', 'in', ['dismissed', 'superseded'])
          .returningAll()
          .executeTakeFirst()
        if (!row) return null
        await trx
          .updateTable('session_plans')
          .set({ status: 'superseded', decided_at: at, ...LEFT_PRESENTED })
          .where('session_id', '=', row.session_id)
          .where('id', '!=', planId)
          .where('status', '=', 'presented')
          .execute()
        return toRecord(row)
      })
    },

    async dismiss(planId, at, by) {
      const row = await db
        .updateTable('session_plans')
        .set({ status: 'dismissed', decided_at: at, dismissed_by: by, ...LEFT_PRESENTED })
        .where('id', '=', planId)
        .where('status', 'in', ['presented', 'approved'])
        .returningAll()
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async presented(owner) {
      const row = await db
        .selectFrom('session_plans')
        .selectAll()
        .where('user_id', '=', owner.userId)
        .where('session_id', '=', owner.sessionId)
        .where('status', '=', 'presented')
        .orderBy('version', 'desc')
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async complete(planId, summary, at) {
      const row = await db
        .updateTable('session_plans')
        .set({
          status: 'completed',
          completed_at: at,
          completion_summary: summary,
          ...LEFT_PRESENTED,
        })
        .where('id', '=', planId)
        .where('status', '=', 'approved')
        .returningAll()
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async listAwaitingReview() {
      const rows = await db
        .selectFrom('session_plans')
        .selectAll()
        .where('status', '=', 'presented')
        .where('awaiting_person', '=', 1)
        .execute()
      return rows.map(toRecord)
    },

    async nextReviewRound(planId) {
      const row = await db
        .updateTable('session_plans')
        .set((eb) => ({ review_round: eb('review_round', '+', 1) }))
        .where('id', '=', planId)
        .where('status', '=', 'presented')
        .returning('review_round')
        .executeTakeFirst()
      return row ? row.review_round : null
    },

    async reviewDelivered(planId) {
      await db
        .updateTable('session_plans')
        .set({ awaiting_person: 0 })
        .where('id', '=', planId)
        .execute()
    },
  }
}
