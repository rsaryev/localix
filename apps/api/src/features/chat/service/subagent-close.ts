import { cancelLane } from '../../agent-core/delegation-lanes'
import { dropExpectedReport } from '../../agent-core/delegation-awaits'
import { ApiError } from '../../../lib/errors'
import { discardWaitingMessages } from './subagent-messages'
import type { TurnEntryContext } from './turn-entry'

/**
 * CLOSING a delegated child — `fork` action close: stopped now, and never woken again.
 *
 * Stop is not enough on its own once a child can be messaged back to life: a stopped child is
 * one message away from running again, and a person who is done with a child wants it DONE —
 * not one stray report, queued message or retried wake away from another run. So a close is a
 * state, persisted on the session (`closed_at`), and every door into a run checks it:
 *
 *   the delegator's message (`subagent-messages.ts`) · the person's send (`turn-entry.ts`) ·
 *   any queued wake at drain time (`wake-queue/drain.ts`)
 *
 * The order here is what makes that airtight: the mark is written FIRST, so a wake racing the
 * close is refused at the drain instead of slipping in between; then everything already waiting
 * is dropped — its lane request, its held messages, its queued wakes; then the run, if any, stops.
 * The run's own end then reports nothing (`run/child-run-report.ts`): the delegator closed it and
 * needs no report saying so.
 */

export type SubagentCloseResult =
  | { closed: true; wasRunning: boolean; alreadyClosed: boolean }
  | { closed: false; reason: 'gone' | 'not-subagent' }

type Ctx = Pick<TurnEntryContext, 'runner' | 'requireSession' | 'repo' | 'now' | 'publishSession'>

export async function closeSubagent(
  ctx: Ctx,
  userId: string,
  sessionId: string,
): Promise<SubagentCloseResult> {
  const session = await ctx.requireSession(userId, sessionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  })
  if (!session) return { closed: false, reason: 'gone' }
  if (session.sessionKind !== 'subagent') return { closed: false, reason: 'not-subagent' }
  if (session.closedAt) return { closed: true, wasRunning: false, alreadyClosed: true }

  const closedAt = ctx.now()
  await ctx.repo.updateSession(userId, sessionId, { closedAt })
  cancelLane(sessionId)
  discardWaitingMessages(sessionId)
  dropExpectedReport(sessionId)
  await ctx.runner.clearQueued(userId, sessionId)
  const wasRunning = ctx.runner.isBusy(sessionId)
  if (wasRunning) await ctx.runner.stop(sessionId)
  // Every open view of the child turns read-only at once, not on its next reload.
  ctx.publishSession({ ...session, closedAt })
  return { closed: true, wasRunning, alreadyClosed: false }
}
