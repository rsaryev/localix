import type { CallClass } from '@localixai/agent/agents'

/**
 * One `plan` call's class. Every action acts on THIS conversation's plan, deleted with it — so
 * `present` and `complete` are `session` (plan mode, which refuses files/host/external, must
 * still allow presenting), and `read` is a `read`. Keyed by the action enum, so an action added
 * without a class here fails `tsc`; anything outside the enum is `external` (fail-closed).
 */
export const PLAN_ACTIONS = ['present', 'read', 'complete'] as const
export type PlanAction = (typeof PLAN_ACTIONS)[number]

const PLAN_CLASSES: Record<PlanAction, CallClass> = {
  present: { effect: 'session' },
  read: { effect: 'read' },
  complete: { effect: 'session' },
}

export function classifyPlanCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action
  return typeof action === 'string' && Object.hasOwn(PLAN_CLASSES, action)
    ? PLAN_CLASSES[action as PlanAction]
    : { effect: 'external' }
}
