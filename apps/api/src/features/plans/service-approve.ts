/**
 * APPROVING A VERSION — the person's decision.
 *
 *   validate the version → mark approved → settle the attention → switch the mode → say it →
 *   wake the conversation.
 *
 * The mode comes before the wake, so the turn the wake opens already runs under it.
 */
import { planApprovedKey, type ImplementationMode, type PlanRecord } from './contracts'
import { planNotice } from './notices'
import type { PlanOwner } from './repository'
import type { PlanServiceCore } from './service-core'
import type { PlanDecision } from './service'
import { planApprovedText } from './wake-content'

/**
 * The version already stands approved in this mode. Who it was addressed to is not compared: the
 * first approval's wake already went out under its once-ever key, and a repeat cannot re-send it.
 */
const isSameApproval = (plan: PlanRecord, mode: ImplementationMode): boolean =>
  plan.status === 'approved' && plan.approvedMode === mode

export function createApproveOps(core: PlanServiceCore) {
  const { deps, now } = core
  const lifecycle = deps.lifecycle

  async function approve(
    owner: PlanOwner,
    planId: string,
    mode: ImplementationMode,
  ): Promise<PlanDecision> {
    const current = await core.requirePlan(owner, planId)
    // The same approval again — a second tab, or a client whose list missed the frame and still
    // offered Approve — is answered with the versions as they are: the decision
    // the person asked for already stands, so a 409 would only be a red error about nothing.
    if (isSameApproval(current, mode)) return repeated(owner, current)
    // An older version may be approved only while a review is still open — a newer version
    // waiting. Once the conversation left Plan mode (which set the waiting version aside), a
    // superseded version approved later would switch the mode again behind the person's back.
    if (current.status === 'superseded' && !(await deps.repo.presented(owner)))
      return core.conflict(owner, current)
    // Approved BEFORE the mode moves: leaving plan mode sets aside whatever version is still
    // `presented` (`permissionModeChanged`), and that must not be the one being approved.
    const plan = await deps.repo.approve(planId, mode, now())
    if (!plan) {
      // Decided meanwhile: the same approval from another tab is still this one.
      const after = await core.requirePlan(owner, planId)
      return isSameApproval(after, mode) ? repeated(owner, after) : core.conflict(owner, after)
    }
    // The snapshot the implementing agent is pointed at is the approved text, re-written from
    // the row in case the file was edited since. Best-effort: the row is the source of truth.
    await deps.files.writeSnapshot(owner, plan.version, plan.body).catch(() => undefined)
    const plans = await core.publish(owner)
    lifecycle?.settled(owner, plan.id, 'answered')
    // Approving an older version superseded the newer one that was waiting.
    lifecycle?.settled(owner, null, 'superseded')
    await deps.setMode(owner, mode)
    await core.notice(owner, planNotice.approved(plan, mode))
    const outcome = await deps.wake({
      userId: plan.userId,
      sessionId: plan.sessionId,
      content: planApprovedText(plan, mode),
      source: 'plan-approved',
      deliveryKey: planApprovedKey(plan.id),
      receipt: true,
    })
    return { plan: await core.view(owner, plan), wake: outcome.status, plans }
  }

  /** Repeating an approval wakes nobody: the first one already did (once-ever delivery key). */
  const repeated = async (owner: PlanOwner, plan: PlanRecord): Promise<PlanDecision> => ({
    plan: await core.view(owner, plan),
    wake: null,
    plans: await core.listViews(owner),
  })

  return { approve }
}
