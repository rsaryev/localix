/**
 * AN APPROVED PLAN THAT IS NOT DONE — the plan's resume point (`features/resume`).
 *
 * Approval hands the work over once (its wake has a once-ever key); when that run stopped — the
 * person pressed Stop, a turn failed, the app restarted — the plan stayed approved with nobody on
 * it, and the composer offered only "Open". This is the plan's answer to "what is unfinished
 * here": the one approved version, until the agent completes it or the person sets it aside.
 * Continuing it tells the agent to pick the work up again, with the plan's text in hand.
 */
import { resumeKey, type ResumeOwner, type ResumeProducer } from '../resume/contracts'
import type { SessionPlan } from './contracts'
import { planNotice } from './notices'
import { planResumeText } from './wake-content'

export const PLAN_RESUME_KIND = 'plan'

export function planResumeProducer(plans: {
  /** The owner's approved, not yet completed version. */
  approved(owner: ResumeOwner): Promise<SessionPlan | null>
}): ResumeProducer {
  return {
    kind: PLAN_RESUME_KIND,
    async list(owner) {
      const plan = await plans.approved(owner)
      if (!plan) return []
      return [
        {
          key: resumeKey(PLAN_RESUME_KIND, plan.id),
          kind: PLAN_RESUME_KIND,
          title: `Plan v${plan.version}`,
          detail: plan.title,
        },
      ]
    },
    async take(owner, key) {
      const plan = await plans.approved(owner)
      // Completed, set aside or replaced since the person saw the button: nothing to continue.
      if (!plan || key !== resumeKey(PLAN_RESUME_KIND, plan.id)) return null
      return { content: planResumeText(plan), notice: planNotice.resumed(plan) }
    },
  }
}
