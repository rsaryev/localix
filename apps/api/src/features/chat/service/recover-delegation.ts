/**
 * THE RECOVERY HALF OF A CHILD'S REPORT: re-send a report whose live wake never reached durable
 * admission, and never rerun the child.
 *
 * The live seam (`run/child-run-report.ts`) reports each run of a child the moment it settles.
 * A process that dies between a run's end and its report's admission leaves a terminal child
 * whose LATEST run has no receipt; this sweep finds exactly those, for EVERY user who owns one,
 * and sends the same wake the live path would have (`delegationReportWake`, keyed by that run's
 * final assistant message, `receipt: true`), so whichever path reaches the store first is the
 * one report. Only the latest run is recovered: an earlier run's lost report is superseded by
 * the one after it, which is the state the parent needs to act on. A run whose report the live
 * seam decided AGAINST (stopped, or nobody was waiting on it) carries a receipt as well
 * (`recordDecidedDelivery`), so "no receipt" still means only "the process died first".
 *
 * It looks back only as far as receipts are kept (`delivery-receipts.ts`): past that horizon a
 * missing receipt may be a PRUNED one, and re-sending would be the duplicate the receipt exists
 * to stop. Pruning runs here too, so the table and the window move together.
 */
import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../../db/types'
import { participantAgentId } from '../../../db/participant'
import type { createChatService } from '../service'
import { DELEGATION_REPORT_KEY_PREFIX, delegationReportWake } from '../runtime/delegation-report'
import { pruneDeliveryReceipts, receiptHorizon } from '../runtime/delivery-receipts'

/** A child this young may still be reporting live; the sweep leaves it to that path. */
const LIVE_GRACE_MS = 30_000

type Wake = ReturnType<typeof createChatService>['wakeSession']

/** The child's latest assistant row — its latest run's identity, as the live seam keys it. */
const LATEST_RUN_ID = sql<string | null>`(SELECT m.id FROM agent_messages m
  WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.sequence DESC LIMIT 1)`

/** The window both queries read: settled past the grace period, inside the receipt horizon. */
const settledWithin = (now: number) => ({
  after: receiptHorizon(now),
  before: new Date(now - LIVE_GRACE_MS).toISOString(),
})

/**
 * The users owning a candidate child. Read first, because the per-user scan below is what the
 * recovery index serves; a scan without the user leads with no key and reads every session.
 */
export function recoveryUsersQuery(db: Kysely<AppDatabase>, now = Date.now()) {
  const window = settledWithin(now)
  return db
    .selectFrom('agent_sessions')
    .select('user_id')
    .distinct()
    .where('session_kind', '=', 'subagent')
    .where('runtime_status', 'in', ['completed', 'failed', 'stopped'])
    .where('updated_at', '>', window.after)
    .where('updated_at', '<', window.before)
}

/** Kept as a builder so query-plan tests exercise the production recovery scan. */
export function delegationRecoveryQuery(db: Kysely<AppDatabase>, userId: string, now = Date.now()) {
  const window = settledWithin(now)
  return (
    db
      .selectFrom('agent_sessions as s')
      .innerJoin('agent_sessions as parent', (join) =>
        join
          .onRef('parent.id', '=', 's.parent_session_id')
          .onRef('parent.user_id', '=', 's.user_id'),
      )
      // Keyed by the latest run exactly as the live seam keys it; a child that never produced an
      // assistant row failed at launch, which the continuation reports as the `launch` run.
      .leftJoin('agent_delivery_receipts as receipt', (join) =>
        join.onRef(
          'receipt.delivery_key',
          '=',
          sql<string>`${DELEGATION_REPORT_KEY_PREFIX} || s.id || ':' || coalesce(${LATEST_RUN_ID}, 'launch')`,
        ),
      )
      .select(['s.id', 's.title', 's.parent_session_id', 's.runtime_status'])
      .select(sql<string | null>`${LATEST_RUN_ID}`.as('run_id'))
      .select(
        sql<string | null>`json_extract(s.invocation_json, '$.parentParticipant')`.as('recipient'),
      )
      // The delegating participant's handle in the session the report lands in — the delegator's
      // own (`delegationReportSession`) — so a recovered report routes exactly like a live one.
      .select(
        sql<string | null>`(SELECT sa.handle FROM conversation_participants sa
      WHERE sa.session_id = parent.id
        AND 'agent:' || sa.agent_id = json_extract(s.invocation_json, '$.parentParticipant'))`.as(
          'recipient_handle',
        ),
      )
      .select(
        sql<string | null>`(SELECT json_extract(m.payload_json, '$.content') FROM agent_messages m
      WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.sequence DESC LIMIT 1)`.as(
          'report',
        ),
      )
      .where('s.user_id', '=', userId)
      .where('s.session_kind', '=', 'subagent')
      .where(sql<string>`json_extract(s.invocation_json, '$.kind')`, '=', 'task-delegation')
      .where('s.runtime_status', 'in', ['completed', 'failed', 'stopped'])
      .where('s.updated_at', '>', window.after)
      .where('s.updated_at', '<', window.before)
      .where('receipt.delivery_key', 'is', null)
      .orderBy('s.updated_at', 'asc')
      .limit(100)
  )
}

async function recoverForUser(
  db: Kysely<AppDatabase>,
  userId: string,
  wake: Wake,
  now: number,
): Promise<number> {
  let delivered = 0
  for (const child of await delegationRecoveryQuery(db, userId, now).execute()) {
    const parentSessionId = child.parent_session_id
    if (!parentSessionId) continue
    try {
      const result = await wake(
        delegationReportWake({
          userId,
          parent: { id: parentSessionId },
          delegatingAgentId: child.recipient ? participantAgentId(child.recipient) : null,
          handle: child.recipient_handle,
          label: child.title,
          childSessionId: child.id,
          runId: child.run_id ?? 'launch',
          status: child.runtime_status,
          text: child.report,
        }),
      )
      if (result.delivered) delivered++
    } catch (error) {
      // One unavailable parent must not starve unrelated completed children. No
      // receipt is written here: failed admission remains eligible on the next start's sweep.
      console.warn('[delegate] recovered report delivery failed:', child.id, error)
    }
  }
  return delivered
}

/** Prune expired receipts, then recover every user's unreported children. Never rerun them. */
export async function recoverDelegationReports(
  db: Kysely<AppDatabase>,
  wake: Wake,
  now = Date.now(),
): Promise<number> {
  await pruneDeliveryReceipts(db, now)
  let delivered = 0
  for (const { user_id } of await recoveryUsersQuery(db, now).execute())
    delivered += await recoverForUser(db, user_id, wake, now)
  return delivered
}
