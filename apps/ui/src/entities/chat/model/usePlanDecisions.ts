/**
 * The person's three decisions on a presented plan — approve (with the mode and who starts),
 * request changes, dismiss — shared by the composer strip and the plan tab, so both show the same
 * busy state and say the same thing when a decision did not reach the agent.
 *
 * A decision STANDS even when its wake was not delivered (the server recorded it first). Staying
 * silent then would leave the person waiting for an agent that was never told, so a wake other
 * than `delivered` is surfaced; a delivered one needs no toast — the turn it opens is the answer.
 *
 * EVERY ANSWER CARRIES THE CONVERSATION'S VERSIONS, AND THEY ARE APPLIED AT ONCE. The client used
 * to wait for the `plan.updated` frame; when that frame was missed (a reconnect gap) the strip
 * kept offering Approve on a version the server had approved, and each click was a red "already
 * approved" error that corrected nothing. Now the answer's list lands through the
 * same reducer as the frame, and a version decided meanwhile (a 409 carrying the list) is not an
 * error: the strip corrects itself and the person is told, transiently, what had already happened.
 */
import { useState } from 'react'
import type { ImplementationMode, SessionPlan } from '@localixai/api/client'
import { PERMISSION_MODE_COPY } from '@localixai/api/permission-modes'
import { backendClient } from '@/shared/api/client'
import type { PlanAnswer, PlanWakeStatus } from '@/shared/api/plans-client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { loadPlanComments, reportPlanCommentsLoad } from './planComments'
import { applyPlanList } from './plans'

type Decision = 'approve' | 'request-changes' | 'dismiss' | 'reopen'

function reportWake(wake: PlanWakeStatus, what: string): void {
  // `null`: the same decision repeated — nobody was meant to be woken again.
  if (wake === 'delivered' || wake === null) return
  toast.warning(`${what}, but the agent was not woken`, {
    description:
      wake === 'missed'
        ? 'The decision is saved. Send a message to continue.'
        : 'The decision is saved; delivering it failed. Send a message to continue.',
  })
}

/**
 * Apply the answer's versions; answer the decision's own fields, or null when the version had
 * been decided meanwhile — said as own-action feedback (`toast.info`, transient), never as a
 * journal error, because nothing failed: the person was looking at an old state.
 */
function settle<T>(ownerId: string, planId: string, answer: PlanAnswer<T>): T | null {
  if (answer?.plans) applyPlanList(ownerId, answer.plans)
  if (!answer?.conflict) return answer as T
  const now = answer.plans.find((plan) => plan.id === planId)
  toast.info(now ? `Plan v${now.version} was already ${now.status}` : answer.conflict.message)
  return null
}

export function usePlanDecisions(ownerId: string | null) {
  const [busy, setBusy] = useState<Decision | null>(null)

  /** Answers whether the decision is settled, so a caller can close what it was shown in. */
  const run = async (
    decision: Decision,
    act: (ownerId: string) => Promise<void>,
    failure: string,
  ): Promise<boolean> => {
    if (!ownerId || busy) return false
    setBusy(decision)
    try {
      await act(ownerId)
      return true
    } catch (error) {
      toast.error(failure, { description: errorMessage(error, '') || undefined })
      return false
    } finally {
      setBusy(null)
    }
  }

  return {
    busy,
    // Approve and dismiss need only the version's id: the cross-session attention dialog decides
    // on a plan whose versions this window never loaded.
    // `to` is who starts (a handle or `all`); without it the conversation's default answerer does.
    approve: (plan: Pick<SessionPlan, 'id'>, mode: ImplementationMode, to?: string) =>
      run(
        'approve',
        async (owner) => {
          const result = settle(
            owner,
            plan.id,
            await backendClient.approvePlan(owner, plan.id, mode, to),
          )
          if (result)
            reportWake(result.wake, `Plan approved in ${PERMISSION_MODE_COPY[mode].label} mode`)
        },
        'Could not approve the plan',
      ),
    requestChanges: (plan: SessionPlan, note?: string) =>
      run(
        'request-changes',
        async (owner) => {
          const result = settle(
            owner,
            plan.id,
            await backendClient.requestPlanChanges(owner, plan.id, note),
          )
          // The server marked the sent comments `sent` — or reopened them when nobody was woken.
          // The request itself stands; a refresh that failed would show them still pending, so
          // it is said rather than swallowed.
          await loadPlanComments(plan.id, true).catch(reportPlanCommentsLoad)
          if (result) reportWake(result.wake, 'Changes requested')
        },
        'Could not request changes',
      ),
    dismiss: (plan: Pick<SessionPlan, 'id'>) =>
      run(
        'dismiss',
        async (owner) => {
          settle(owner, plan.id, await backendClient.dismissPlan(owner, plan.id))
        },
        'Could not dismiss the plan',
      ),
    // A version set aside — by the person, or by leaving Plan mode — comes back as it was. Without
    // this the only way back was asking the agent to retype it as a new version.
    reopen: (plan: Pick<SessionPlan, 'id'>) =>
      run(
        'reopen',
        async (owner) => {
          settle(owner, plan.id, await backendClient.reopenPlan(owner, plan.id))
        },
        'Could not bring the plan back for review',
      ),
  }
}
