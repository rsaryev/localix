/**
 * PRESENTING THE DRAFT, AND BRINGING A VERSION BACK — the half of the plan's lifecycle that reads
 * the plan's files (`plan-files.ts`).
 *
 * The defect this half exists to stop: the plan lived only in the `present` call's argument, so
 * a change meant retyping it and a version set aside could never come back — the agent re-typed
 * it as a new number instead. Now the agent edits `PLAN.md` and `present` snapshots
 * it; text the latest version already has is answered by that version (`presentation.ts`), and
 * `restore` is the one path that returns a version to review — used by `present`, by the return
 * to Plan mode and by the person's `reopen` alike, so all three say and raise the same things.
 *
 * Every transition keeps the service's order: validate → decide (one guarded write) → snapshot →
 * publish → one conversation line → one attention item.
 */
import { InvalidRequestError } from '../../lib/domain-errors'
import type { StoredSystemNotice } from '../../db/payload'
import {
  PLAN_BODY_MAX,
  toSessionPlan,
  type PlanOverview,
  type PlanPresentation,
  type PlanRecord,
  type PresentInput,
  type SessionPlan,
} from './contracts'
import { planNotice } from './notices'
import { planDraftPath } from './plan-paths'
import { decidePresentation, samePlanText, versionTitle } from './presentation'
import type { PlanOwner } from './repository'
import type { PlanServiceCore } from './service-core'

export function createPresentOps(core: PlanServiceCore) {
  const { deps, now } = core
  const lifecycle = deps.lifecycle

  const handleOf = async (owner: PlanOwner, agentId: string): Promise<string | null> =>
    lifecycle ? lifecycle.authorHandle(owner, agentId).catch(() => null) : null

  /**
   * The snapshot is re-written from the stored body whenever the host touches a version, so the
   * file the person and the agent open is the text that was approved. Best-effort: the row is the
   * source of truth, and an unreachable disk must not undo a decision already stored.
   */
  const snapshot = (owner: PlanOwner, plan: PlanRecord): Promise<void> =>
    deps.files.writeSnapshot(owner, plan.version, plan.body).catch(() => undefined)

  /**
   * A version now waits on the person: push, cue the tab, say it, raise it.
   *
   * The cue (`plan.presented`) is its own live-only frame because "a version was presented just
   * now" is an EVENT, and the versions list is STATE: a client used to infer the event from the
   * state (a presented version younger than two minutes it had not seen before), and that guess
   * opened the tab on a reload and missed it after a whole-body replace. The event is said once,
   * here, the moment it happens; a reload replays the state and never the cue.
   */
  const announce = async (
    owner: PlanOwner,
    plan: SessionPlan,
    line: (handle: string | null) => StoredSystemNotice,
  ): Promise<void> => {
    await core.publish(owner)
    deps.presented?.(owner, plan)
    const handle = await handleOf(owner, plan.authorAgentId)
    await core.notice(owner, line(handle))
    lifecycle?.awaiting(owner, plan, handle)
  }

  /** Bring a dismissed or superseded version back to review. Null when it was decided meanwhile. */
  async function restore(owner: PlanOwner, record: PlanRecord): Promise<SessionPlan | null> {
    const restored = await deps.repo.restore(record.id, now())
    if (!restored) return null
    await snapshot(owner, restored)
    const plan = await core.view(owner, restored)
    await announce(owner, plan, () => planNotice.restored(plan))
    return plan
  }

  /** The draft — written from `input.body` first when one is given — as the next version. */
  async function present(
    owner: PlanOwner,
    authorAgentId: string,
    input: PresentInput,
  ): Promise<PlanPresentation> {
    const dir = await deps.files.dir(owner)
    const draftPath = planDraftPath(dir)
    if (input.body !== undefined) await deps.files.writeDraft(owner, input.body)
    const draft = (input.body ?? (await deps.files.readDraft(owner)) ?? '').trim()
    if (!draft)
      throw new InvalidRequestError(
        'plan_draft_missing',
        `There is no plan to present: write it to ${draftPath} first.`,
      )
    if (draft.length > PLAN_BODY_MAX)
      throw new InvalidRequestError(
        'plan_too_long',
        `The plan is over ${PLAN_BODY_MAX} characters; shorten ${draftPath}.`,
      )

    const latest = (await deps.repo.list(owner))[0]
    const decision = decidePresentation(draft, latest)
    if (decision.kind === 'unchanged')
      return { outcome: 'unchanged', plan: toSessionPlan(decision.plan, dir) }
    if (decision.kind === 'restore') {
      const plan =
        (await restore(owner, decision.plan)) ??
        (await core.conflict(
          owner,
          decision.plan,
          'plan_decided',
          (current) => `Plan v${current.version} changed meanwhile`,
        ))
      return { outcome: 'restored', plan }
    }

    const title = versionTitle(input.title, draft, latest)
    const record = await deps.repo.present(owner, authorAgentId, { title, body: draft }, now())
    await snapshot(owner, record)
    const plan = toSessionPlan(record, dir)
    await announce(owner, plan, (handle) => planNotice.presented(plan, handle))
    return { outcome: 'presented', plan }
  }

  /**
   * The person brings the LATEST version back after it was set aside — by them, or by leaving
   * Plan mode. Only the latest: an older one would be a review of text the agent has already
   * revised. The conversation returns to Plan mode first, through the session update path, so
   * the review it reopens is one the agent can still act on; that mode change may itself restore
   * the version (`permissionModeChanged`), which is then the answer.
   *
   * Reopening the latest version while it is already back in review is the same decision
   * repeated, answered with the versions as they are rather than a 409.
   */
  async function reopen(
    owner: PlanOwner,
    planId: string,
  ): Promise<{ plan: SessionPlan; plans: SessionPlan[] }> {
    const plan = await core.requirePlan(owner, planId)
    const latest = (await deps.repo.list(owner))[0]
    const answer = async (record: PlanRecord) => ({
      plan: await core.view(owner, record),
      plans: await core.listViews(owner),
    })
    if (latest?.id === plan.id && plan.status === 'presented') return answer(plan)
    if (plan.status !== 'dismissed' || latest?.id !== plan.id)
      return core.conflict(
        owner,
        plan,
        'plan_not_reopenable',
        (current) =>
          `Only the latest version, once set aside, can be reopened; v${current.version} is ${current.status}`,
      )
    await deps.setMode(owner, 'plan')
    const after = await core.requirePlan(owner, planId)
    if (after.status === 'presented') return answer(after)
    const restored = await restore(owner, after)
    if (!restored) return core.conflict(owner, after)
    return { plan: restored, plans: await core.listViews(owner) }
  }

  /** Every version and the draft's state — the person's plan view and the agent's `read`. */
  async function overview(owner: PlanOwner): Promise<PlanOverview> {
    const [dir, records, draft] = await Promise.all([
      deps.files.dir(owner),
      deps.repo.list(owner),
      deps.files.readDraft(owner),
    ])
    const latest = records[0]
    const written = draft !== null && draft.trim() !== ''
    return {
      plans: records.map((record) => toSessionPlan(record, dir)),
      draft: {
        path: planDraftPath(dir),
        exists: draft !== null,
        changed: written && (!latest || !samePlanText(draft, latest.body)),
      },
    }
  }

  return { present, restore, reopen, overview }
}
