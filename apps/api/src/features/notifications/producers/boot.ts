import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db/types'
import type { NotificationJournal } from '../journal'
import { HITL_ATTENTION_PREFIX as HITL_PREFIX } from '../../attention/contracts'
import { childKey, continueAction, failureKey } from './runs'
import {
  isInternalSession,
  openChatAction,
  resourceOrigin,
  resolveSession,
  type LookupSession,
} from './facts'

/**
 * WHAT A RESTART MADE TRUE, recorded before this process can raise anything of its own.
 *
 * Two facts have no live seam because the process they happened in is gone:
 *
 *   - every pending question died with the old process — the HITL registry is memory-only — so an
 *     open `hitl:` row offers "Respond" for a request nothing will accept. Every one is stale by
 *     construction, so all are settled (`restart`). This MUST complete before a new request can be
 *     raised, or the prefix settle would close a live question too; the caller awaits it at boot.
 *     Also `question:`: rows left by the retired queued questions, whose subject no longer exists.
 *     A plan under review (`plan:`) survives the restart, and the attention registry restores it;
 *   - a run that was mid-flight left a truncated reply. The transcript gets a notice
 *     (`interrupted-runs.ts`); the inbox gets a warning, filed under the failure prefix so the
 *     session's next finished run settles it like any superseded failure.
 */

/** `question:` is the retired queued-question kind; nothing raises it any more. */
const STALE_PREFIXES = [HITL_PREFIX, 'question:'] as const

export async function settleStaleRequests(
  db: Kysely<AppDatabase>,
  journal: NotificationJournal,
): Promise<void> {
  for (const prefix of STALE_PREFIXES) {
    const owners = await db
      .selectFrom('notification_inbox')
      .select('user_id')
      .distinct()
      .where('state', '=', 'open')
      .where('subject_key', 'like', `${prefix}%`)
      .execute()
    for (const { user_id } of owners) journal.settle(user_id, { prefix, reason: 'restart' })
  }
  await journal.flush()
}

export interface InterruptedRun {
  runId: string
  sessionId: string
  userId: string
}

export const interruptedKey = (sessionId: string, runId: string) =>
  failureKey(sessionId, `interrupted:${runId}`)

export async function recordInterruptedRuns(
  deps: { journal: NotificationJournal; lookupSession: LookupSession },
  runs: readonly InterruptedRun[],
): Promise<void> {
  for (const run of runs) {
    const session = await resolveSession(deps.lookupSession, run.userId, run.sessionId)
    if (isInternalSession(session)) continue
    const child = session.sessionKind === 'subagent' || session.sessionKind === 'job'
    deps.journal.record(run.userId, {
      key: child
        ? childKey(session.id, `interrupted:${run.runId}`)
        : interruptedKey(session.id, run.runId),
      topic: child ? 'child.failed' : 'run.failed',
      category: 'agent',
      severity: 'warning',
      title: child ? 'Sub-agent interrupted by a restart' : 'Agent run interrupted by a restart',
      body: session.title
        ? `${session.title} — the reply is incomplete.`
        : 'The reply is incomplete.',
      origin: resourceOrigin(session, 'run', run.runId, child ? 'Sub-agent' : 'Agent run'),
      // A root conversation's cut-off reply is its resume point: Continue picks it up.
      actions: child
        ? [openChatAction(session)]
        : [openChatAction(session), continueAction(session, run.runId)],
    })
  }
}
