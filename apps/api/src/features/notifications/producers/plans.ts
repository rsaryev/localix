import type { SessionPlan } from '../../plans/contracts'
import type { NotificationJournal } from '../journal'
import {
  openChatAction,
  resourceOrigin,
  resolveSession,
  type LookupSession,
  type OrderedLane,
} from './facts'

/**
 * THE APPROVED PLAN IS DONE — the last step of a plan's lifecycle, as an Event Center row.
 *
 * Plan mode exists so the person can approve work and walk away; the work then runs, often for a
 * long time, in a mode where nothing asks them anything. Without this row the end of that work
 * was a turn that simply stopped, indistinguishable in the journal from any other finished run.
 * It is informational and settles nothing: nobody has to act on it (the waiting step, the
 * review, was an attention item and settled when the person approved).
 *
 * Keyed by the plan, so a replayed completion is the same row.
 */
export interface PlanNotifications {
  completed(userId: string, plan: SessionPlan): void
}

export const planCompletedKey = (plan: Pick<SessionPlan, 'sessionId' | 'id'>) =>
  `plan-completed:${plan.sessionId}:${plan.id}`

export function createPlanNotifications(deps: {
  journal: NotificationJournal
  lane: OrderedLane
  lookupSession: LookupSession
}): PlanNotifications {
  const { journal, lane, lookupSession } = deps
  return {
    completed(userId, plan) {
      lane.run(async () => {
        const session = await resolveSession(lookupSession, userId, plan.sessionId)
        journal.record(userId, {
          key: planCompletedKey(plan),
          topic: 'run.completed',
          category: 'agent',
          severity: 'info',
          title: `Plan v${plan.version} completed`,
          body: plan.completionSummary?.trim() || plan.title,
          origin: resourceOrigin(session, 'plan', plan.id, 'Plan'),
          actions: [openChatAction(session)],
        })
      })
    },
  }
}
