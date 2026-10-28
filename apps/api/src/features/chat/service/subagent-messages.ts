import { frameDelegatorMessage } from '../../agent-core/interjection'
import { requestLane, type DelegationPriority } from '../../agent-core/delegation-lanes'
import { expectReport } from '../../agent-core/delegation-awaits'
import { ApiError } from '../../../lib/errors'
import type { SessionRecord } from '../repository'
import type { TurnEntryContext } from './turn-entry'

/**
 * A delegator speaking to its child — `fork` action message.
 *
 * A delegated child used to be unreachable once started: its delegator could watch it and nothing
 * else, so a brief that turned out wrong ran to completion on the wrong premise, and a follow-up
 * meant a second delegation that knew nothing the first had learned. Now the delegator writes to
 * the child the way a person writes into a chat:
 *
 *   child running → the message joins its run at the next step (`isDelegatorMessage`);
 *   child idle    → the message waits for one of the parent's lanes (`delegation-lanes.ts`), then
 *                   opens a new run in the same session, with everything the child knows;
 *   child closed  → refused: a closed child is never woken again (`subagent-close.ts`).
 *
 * Either way the run that answers ends with a report the parent receives, once it finishes or
 * fails (`run/child-run-report.ts`, `delegation-awaits.ts`). The
 * message is framed HERE, once, since the same text may join a running step or open a run.
 *
 * WAITING MESSAGES are held in this module, not in the child's wake queue, because the wake queue
 * would start a run the moment the child is idle — straight past the lane it is waiting for.
 */

export type SubagentMessageDelivery =
  | { delivered: true; state: 'running' }
  | { delivered: true; state: 'started' }
  | { delivered: true; state: 'interrupted' }
  | { delivered: true; state: 'queued'; position: number }
  | { delivered: false; reason: 'gone' | 'not-subagent' | 'closed' }

type Ctx = Pick<TurnEntryContext, 'runner' | 'requireSession'> &
  Partial<Pick<TurnEntryContext, 'repo'>>

/** childId → framed messages waiting for the child's next lane. */
const waiting = new Map<string, { userId: string; messages: string[] }>()

/** The parent whose lanes a child runs in — the session that delegated it. */
const parentOf = (session: SessionRecord): string =>
  session.provenance.kind === 'task-delegation'
    ? session.provenance.parentSessionId
    : (session.parentSessionId ?? session.id)

/** Who the child reports to: its delegator's session. */
const delegatorOf = (session: SessionRecord) => ({ sessionId: parentOf(session) })

/** The task's priority as delegated; a child from before priorities is `normal`. */
const priorityOf = (session: SessionRecord): DelegationPriority =>
  (session.provenance.kind === 'task-delegation' && session.provenance.priority) || 'normal'

/**
 * Ask for a lane for the messages waiting on `session`; when it is granted, they open one run.
 * A child that already holds or awaits a lane gets no second request: its messages ride the run
 * it is about to start or finish, and `flushWaitingMessages` asks again after that run ends.
 */
function scheduleWaiting(ctx: Ctx, session: SessionRecord) {
  return requestLane(
    parentOf(session),
    session.id,
    () => {
      const held = waiting.get(session.id)
      waiting.delete(session.id)
      if (!held?.messages.length) return
      void ctx.runner
        .wake({
          userId: held.userId,
          session,
          content: held.messages.join('\n\n'),
          source: 'delegator',
          internal: true,
        })
        .catch((error: unknown) =>
          console.warn(`[delegate] could not wake ${session.id} for its messages:`, error),
        )
    },
    priorityOf(session),
  )
}

/**
 * A message that names a priority REPLACES the task's: it is the delegator restating how urgent
 * the work now is, so it is kept for the child's later runs too, not just for this one.
 */
async function withPriority(
  ctx: Ctx,
  userId: string,
  session: SessionRecord,
  priority: DelegationPriority | undefined,
): Promise<SessionRecord> {
  const { provenance } = session
  if (!priority || provenance.kind !== 'task-delegation' || provenance.priority === priority) {
    return session
  }
  const updated = { ...provenance, priority }
  await ctx.repo?.updateSession(userId, session.id, { provenance: updated })
  return { ...session, provenance: updated }
}

export async function messageSubagent(
  ctx: Ctx,
  userId: string,
  sessionId: string,
  content: string,
  priority?: DelegationPriority,
  /** Stop the current run now and restart with this message, instead of waiting for a step. */
  interrupt = false,
): Promise<SubagentMessageDelivery> {
  const found = await ctx.requireSession(userId, sessionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  })
  if (!found) return { delivered: false, reason: 'gone' }
  if (found.sessionKind !== 'subagent') return { delivered: false, reason: 'not-subagent' }
  if (found.closedAt) return { delivered: false, reason: 'closed' }
  const session = await withPriority(ctx, userId, found, priority)
  const framed = frameDelegatorMessage(content)
  // Whichever run answers this message — the one it joins, or one it opens — owes the delegator
  // a report, even a run a person started (`delegation-awaits.ts`).
  expectReport(sessionId, delegatorOf(found))

  // INTERRUPT: the current run is working from a brief that is now wrong, and its next step
  // boundary may be a long tool call away. The message waits in the buffer, the run is stopped,
  // and the run's own end starts the next one with it — through the lanes like any other run
  // (`run/child-run-report.ts`). A stopped run reports nothing, so the run it cut short adds no
  // "STOPPED" report beside the one the redirected run will send.
  if (interrupt && ctx.runner.isBusy(sessionId)) {
    const held = waiting.get(sessionId) ?? { userId, messages: [] }
    held.messages.push(framed)
    waiting.set(sessionId, held)
    await ctx.runner.stop(sessionId)
    // The run may have ended on its own a moment before the stop — its end already passed the
    // seam without seeing the held message, and nothing is running to end again. So start the
    // next run from here. While the run is still finishing, its own end does it; a flush that
    // finds the buffer already taken does nothing, so the two can never start it twice.
    if (!ctx.runner.isBusy(sessionId)) await flushWaitingMessages(ctx, userId, sessionId)
    return { delivered: true, state: 'interrupted' }
  }

  // A run in progress takes it at its next step; no lane is needed, it already has one.
  if (ctx.runner.isBusy(sessionId)) {
    await ctx.runner.wake({ userId, session, content: framed, source: 'delegator', internal: true })
    return { delivered: true, state: 'running' }
  }

  const held = waiting.get(sessionId) ?? { userId, messages: [] }
  held.messages.push(framed)
  waiting.set(sessionId, held)
  const lane = scheduleWaiting(ctx, session)
  if (lane.state === 'queued') return { delivered: true, state: 'queued', position: lane.position }
  // Granted now → `start` already woke the child. Already holding a lane (its run is starting)
  // → the messages wait for that run to end, and `flushWaitingMessages` starts the next one.
  if (waiting.has(sessionId)) return { delivered: true, state: 'queued', position: 1 }
  return { delivered: true, state: 'started' }
}

/**
 * After a child's run ends and its lane is released: if messages arrived that no run took, ask
 * for a lane for them. Called from the run's logical end (`run/child-run-report.ts`) and from a
 * launch that never became a run.
 */
export async function flushWaitingMessages(
  ctx: Ctx,
  userId: string,
  sessionId: string,
): Promise<void> {
  if (!waiting.get(sessionId)?.messages.length) return
  const session = await ctx.requireSession(userId, sessionId).catch(() => null)
  if (!session || session.closedAt) {
    waiting.delete(sessionId)
    return
  }
  scheduleWaiting(ctx, session)
}

/** Drop what a closed child will never read. */
export function discardWaitingMessages(sessionId: string): number {
  const count = waiting.get(sessionId)?.messages.length ?? 0
  waiting.delete(sessionId)
  return count
}

/** Test seam. Never call this from production code. */
export function __resetWaitingMessages(): void {
  waiting.clear()
}
