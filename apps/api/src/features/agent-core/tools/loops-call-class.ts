import type { CallClass } from '@localixai/agent/agents'

/**
 * One `loops` call's class. `list`/`get` must stay `read`, or an agent could not SEE what is
 * scheduled before proposing a change. A loop outlives the conversation's turn and fires on
 * its own, so add/update/run are `host`; a removed loop is gone (`irreversible`). `reschedule`
 * only moves the next fire of a self-pacing loop this session already owns: `session`.
 * Anything else is `external` (fail-closed).
 */
const LOOPS_CLASSES: Record<string, CallClass> = {
  list: { effect: 'read' },
  get: { effect: 'read' },
  reschedule: { effect: 'session' },
  add: { effect: 'host' },
  update: { effect: 'host' },
  run: { effect: 'host' },
  remove: { effect: 'host', irreversible: true },
}

export function classifyLoopsCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action
  // `hasOwn`, not a bare lookup: `action: 'toString'` would otherwise return a prototype method.
  return typeof action === 'string' && Object.hasOwn(LOOPS_CLASSES, action)
    ? LOOPS_CLASSES[action]!
    : { effect: 'external' }
}
