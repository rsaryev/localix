/** The recovery sweep's reads (`service/recover-delegation.ts`): which settled children lack a report receipt. */
import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { DELEGATION_REPORT_KEY_PREFIX } from './runtime/delegation-report'
import { receiptHorizon } from './runtime/delivery-receipts'
import type { RunRow } from './runtime/delegation-report'

/** A child this young may still be reporting live; the sweep leaves it to that path. */
const LIVE_GRACE_MS = 30_000

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

/**
 * One stored assistant row of a child, for the report of the run it ends (`readRunReplies`).
 * The run's earlier rows are found by the link each row keeps to the one before it.
 */
export function runRowReader(db: Kysely<AppDatabase>, sessionId: string, runId: string) {
  return async (messageId: string): Promise<RunRow | null> => {
    const row = await db
      .selectFrom('agent_messages')
      .select([
        sql<string | null>`json_extract(payload_json, '$.content')`.as('content'),
        sql<string | null>`json_extract(payload_json, '$.continuedFromMessageId')`.as('continued'),
        // Only the run's last row says how it ended; the earlier rows' items stay unread.
        sql<
          string | null
        >`CASE WHEN id = ${runId} THEN json_extract(payload_json, '$.items') END`.as('items'),
      ])
      .where('session_id', '=', sessionId)
      .where('id', '=', messageId)
      .executeTakeFirst()
    return row
      ? {
          content: row.content,
          continuedFromMessageId: row.continued,
          items: row.items ? JSON.parse(row.items) : null,
        }
      : null
  }
}

/**
 * The key a report of this child's latest run is recorded under — the same one the sweep joins
 * receipts on — and the delegator's session it would have woken; `null` for a session that is
 * no delegated child.
 */
export async function latestReportKeyParts(
  db: Kysely<AppDatabase>,
  userId: string,
  childId: string,
): Promise<{ runId: string; parentSessionId: string } | null> {
  const row = await db
    .selectFrom('agent_sessions as s')
    .select(['s.parent_session_id'])
    .select(sql<string | null>`${LATEST_RUN_ID}`.as('run_id'))
    .where('s.id', '=', childId)
    .where('s.user_id', '=', userId)
    .where('s.session_kind', '=', 'subagent')
    .executeTakeFirst()
  return row?.parent_session_id
    ? { runId: row.run_id ?? 'launch', parentSessionId: row.parent_session_id }
    : null
}
