/**
 * WHAT EVERY HALF OF THE PLAN'S LIFECYCLE SHARES — reading versions as clients see them, pushing
 * them, the ownership check, and the 409 for a version decided meanwhile.
 *
 * One copy, because the defect was a disagreement between copies of "the versions":
 * the client's list (fed by one frame it could miss) and the server's. Every decision now answers
 * the list `publish` pushed, and every conflict carries the list as it is now (`conflict`), so
 * there is one way to read the versions and every half of the service answers with it.
 */
import { NotFoundError } from '../../lib/domain-errors'
import type { StoredSystemNotice } from '../../db/payload'
import { PlanConflictError } from './conflict'
import { toSessionPlan, type PlanRecord, type SessionPlan } from './contracts'
import type { PlanOwner } from './repository'
import type { PlanServiceDeps } from './service'

// Members are typed as arrow PROPERTIES, not methods: they are closures with no `this`, and the
// service destructures them (`const { publish, view } = core`) — which method syntax declares
// unsafe (`unbound-method`).
export interface PlanServiceCore {
  deps: PlanServiceDeps
  now: () => string
  /** Push every version of the conversation (`plan.updated`), and answer them. */
  publish: (owner: PlanOwner) => Promise<SessionPlan[]>
  /** One conversation line; best-effort. */
  notice: (owner: PlanOwner, line: StoredSystemNotice) => Promise<void>
  /** A stored version as clients see it. */
  view: (owner: PlanOwner, record: PlanRecord) => Promise<SessionPlan>
  /** Every version of the conversation as clients see them, newest first. */
  listViews: (owner: PlanOwner) => Promise<SessionPlan[]>
  /** The caller's version of THIS conversation's plan, or 404. */
  requirePlan: (owner: PlanOwner, planId: string) => Promise<PlanRecord>
  /**
   * Throw the 409 for a version decided meanwhile, carrying every version as it is now
   * (`PlanConflictError`); `message` words it from the version's current state.
   */
  conflict: (
    owner: PlanOwner,
    plan: PlanRecord,
    code?: string,
    message?: (current: SessionPlan) => string,
  ) => Promise<never>
}

export function createPlanServiceCore(deps: PlanServiceDeps): PlanServiceCore {
  const now = deps.now ?? (() => new Date().toISOString())

  /**
   * Stored versions as clients see them, each with its snapshot path in the plan directory. No
   * versions → no directory lookup: the session detail asks this of every root it loads, and
   * resolving the directory opens the session's execution environment.
   */
  const views = async (owner: PlanOwner, records: PlanRecord[]): Promise<SessionPlan[]> => {
    if (!records.length) return []
    const dir = await deps.files.dir(owner)
    return records.map((record) => toSessionPlan(record, dir))
  }
  const view = async (owner: PlanOwner, record: PlanRecord): Promise<SessionPlan> =>
    (await views(owner, [record]))[0]!
  const listViews = async (owner: PlanOwner): Promise<SessionPlan[]> =>
    views(owner, await deps.repo.list(owner))

  return {
    deps,
    now,
    view,
    listViews,

    // A decision returns the list it pushed.
    async publish(owner) {
      const plans = await listViews(owner)
      deps.publish(owner, plans)
      return plans
    },

    async notice(owner, line) {
      await deps.lifecycle?.notice(owner, line).catch(() => undefined)
    },

    // Never someone else's: another user's or another conversation's version is a 404.
    async requirePlan(owner, planId) {
      const plan = await deps.repo.get(owner.userId, planId)
      if (!plan || plan.sessionId !== owner.sessionId)
        throw new NotFoundError('plan_not_found', 'No such plan in this conversation')
      return plan
    },

    // Re-read here, so the sentence names the status that won, not the one the caller last saw.
    async conflict(owner, plan, code = 'plan_decided', message) {
      const plans = await listViews(owner)
      const current =
        plans.find((candidate) => candidate.id === plan.id) ?? (await view(owner, plan))
      throw new PlanConflictError(
        code,
        message?.(current) ?? `Plan v${current.version} is already ${current.status}`,
        plans,
      )
    },
  }
}
