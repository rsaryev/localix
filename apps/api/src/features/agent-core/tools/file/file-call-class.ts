import type { CallClass } from '@localixai/agent/agents'

import { isOwnPlanFile, isPlanFilePath } from '../../../plans/plan-paths'

/**
 * The class of a write/edit call, from its RESOLVED target paths.
 *
 * The defect this exists to stop: every file write was `files`, and plan mode refuses `files` —
 * so the agent could not keep the plan as a file, and every change to a plan meant retyping it
 * whole into `present`. The conversation's plan files (`plans/plan-paths.ts`) are
 * the conversation's own state, so a call that touches ONLY them is `session`, which plan mode
 * allows. One other target makes the whole call `files`: a mixed call must not carry a source
 * edit through plan mode on the back of the plan. No target at all is `files` too — "every
 * target is a plan file" must not hold vacuously for a call that names nothing.
 *
 * Pure: a path test, no lookup (`classify` runs on the permission path). That is also its limit:
 * the tool does not know which conversation it runs in, so the shape matches ANY conversation's
 * plan directory. {@link scopeToOwnPlan} narrows it where the run's own directory is known.
 */
export function fileWriteClass(targets: readonly string[]): CallClass {
  return targets.length > 0 && targets.every(isPlanFilePath)
    ? { effect: 'session' }
    : { effect: 'files' }
}

/**
 * The same class, scoped to the run's OWN conversation. The defect: a plan-mode run could write
 * `.localix/plans/<another conversation's ref>/PLAN.md` as `session` state, and so change a plan
 * that belongs to a conversation it is not in, in the one mode that refuses file writes. The
 * permission gate knows the run's plan directory (`ownPlanDir`); a plan-shaped target outside it
 * is an ordinary file write. No directory (a delegated run, a host that names none) means no
 * plan file is the run's own — fail-closed, every such write is `files`.
 */
export function scopeToOwnPlan(
  declared: CallClass,
  targets: readonly string[],
  ownPlanDir: string | undefined,
): CallClass {
  if (declared.effect !== 'session') return declared
  return ownPlanDir !== undefined &&
    targets.length > 0 &&
    targets.every((target) => isOwnPlanFile(target, ownPlanDir))
    ? declared
    : { effect: 'files' }
}
