/**
 * EVERY RUN OF A DELEGATED CHILD REPORTS TO ITS PARENT — the live half.
 *
 * The report used to be sent by the delegation's continuation, which watches exactly ONE run:
 * the one the delegation launched. A child can now run again — its delegator messages it
 * (`fork` action message) — and those later runs ended in a transcript nobody was reading: the parent
 * had its first report and never heard another word.
 *
 * So the report hangs off the run's LOGICAL END, the one seam every run passes exactly once
 * whichever way it ended (`stages/complete.ts`, `stages/fail.ts` — the same place the run
 * notifications are raised), and it is keyed by that run (`delegationReportKey`). Delegated,
 * worked, reported; messaged, worked, reported.
 *
 * Not every run end is news to the parent, though. A person can drive the child too — stop it,
 * talk it through a problem — and a report per reply of that dialog is spam. So a run reports only
 * when it FINISHED or FAILED while the delegator was waiting to hear (`delegation-awaits.ts`).
 *
 * Order at one run's end: end the child's work record → give its lane to the next child waiting
 * (`delegation-lanes.ts`) → stop here if the child was CLOSED (its delegator closed it and needs
 * no report saying so) → skip the report for a stopped run, a run whose session still has work
 * going (a teammate's queued turn, a child of its own), or one nobody waits on → read the run's
 * final text → wake the ROOT chat → start the next run for any delegator messages no run took.
 * The record ends first so the parent's woken turn does not still list the child as running.
 */
import { hasChildrenAtWork, releaseLane } from '../../../agent-core/delegation-lanes'
import { takeExpectedReport } from '../../../agent-core/delegation-awaits'
import { participantAgentId } from '../../../../db/participant'
import type { SessionRecord } from '../../repository'
import { getAgentService } from '../agent-service-binding'
import {
  delegationReportKey,
  delegationReportSession,
  delegationReportWake,
} from '../delegation-report'
import { recordDecidedDelivery } from '../delivery-receipts'
import { endSubagentWork } from './subagent-work'
import type { RunEnv } from './types'

export interface EndedChildRun {
  userId: string
  session: SessionRecord
  /** The run's final assistant message id — what the report is keyed by. */
  runId: string
  outcome: 'completed' | 'failed' | 'stopped'
}

/** Is this session a child whose runs report to a delegator? */
const reportsToParent = (session: SessionRecord) =>
  session.sessionKind === 'subagent' && session.provenance.kind === 'task-delegation'

export async function reportChildRun(env: RunEnv, run: EndedChildRun): Promise<void> {
  const { session, userId } = run
  if (!reportsToParent(session) || session.provenance.kind !== 'task-delegation') return
  // The run is over whatever happens next: its record and its lane go first, unconditionally,
  // or a missing binding below would hold the lane for good.
  endSubagentWork(env.state, session.id, run.outcome)
  releaseLane(session.id)
  const svc = getAgentService()
  const wake = svc?.wakeSession
  if (!wake) return
  const provenance = session.provenance
  // Read fresh: the record this run started with predates a close that landed during it.
  const current = await env.repo.getSession(userId, session.id).catch(() => null)
  if (current?.closedAt) return
  // Not this run's report, recorded as decided so the recovery sweep does not send it later
  // instead; held delegator messages still start the next run.
  const skip = async () => {
    await recordDecidedDelivery(env.deps.db, {
      deliveryKey: delegationReportKey(session.id, run.runId),
      userId,
      // Where an admitted report's receipt would sit: the session the report would have woken.
      sessionId: delegationReportSession({ id: provenance.parentSessionId }),
    }).catch((error: unknown) =>
      console.warn(`[delegate] could not record the skipped report of ${session.id}:`, error),
    )
    await svc.flushChildMessages?.(userId, session.id)
  }
  // A stopped run reports nothing: the delegator stopped it (its tool result said so), or a
  // person took the child over.
  if (run.outcome === 'stopped') return skip()
  // A child is not done when ONE of its runs ends while its work goes on: a teammate's turn
  // queued in its session, or a child of its own still running — whose report will wake it
  // again. It reports once, when it has gone quiet; the delegator's wait stands until then.
  if ((await env.hasPendingQueue(session.id)) || hasChildrenAtWork(session.id)) return skip()
  // And only while the delegator waits: a person's own dialog with the child answers the person
  // (`delegation-awaits.ts`).
  if (!takeExpectedReport(session.id)) return skip()

  const message = await env.repo.getMessage(userId, session.id, run.runId).catch(() => null)
  const text = message?.payload.role === 'assistant' ? message.payload.content : null
  // Addressed to the delegating participant, by the handle it has in the session the report
  // lands in — the delegator's own session, which for a nested child is a team's.
  const delegatingAgentId = provenance.parentParticipant
    ? participantAgentId(provenance.parentParticipant)
    : null
  const delegator = delegatingAgentId
    ? await env.repo.getSession(userId, provenance.parentSessionId).catch(() => null)
    : null
  const handle = delegator?.agents.find((member) => member.agentId === delegatingAgentId)?.handle

  await wake(
    delegationReportWake({
      userId,
      parent: { id: provenance.parentSessionId },
      delegatingAgentId,
      handle,
      label: session.title,
      childSessionId: session.id,
      runId: run.runId,
      status: run.outcome,
      text,
      ...(provenance.forked ? { forked: true } : {}),
    }),
  )
  await svc.flushChildMessages?.(userId, session.id)
}

/** Fire-and-forget at the seam: a report that fails to send must never fail the run it reports. */
export function sendChildRunReport(env: RunEnv, run: EndedChildRun): void {
  void reportChildRun(env, run).catch((error: unknown) =>
    console.warn(`[delegate] report for ${run.session.id} run ${run.runId} failed:`, error),
  )
}
