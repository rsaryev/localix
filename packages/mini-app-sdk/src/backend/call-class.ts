/**
 * Building blocks for a mini app tool's `classify` — the per-call permission class.
 *
 * Most mini app tools are one name over an `action` enum, often with an `actions: [...]` batch of
 * the same steps. Hand-written per mini app, the same two mistakes recur: a batch classified by its
 * FIRST step (so a `delete` rides behind a `list` past a session that refuses writes), and an
 * action missing from the switch falling through to `read`. These helpers make both impossible
 * by construction: a batch answers the WIDEST class of its steps, and an action the table does
 * not name — or a call naming none — answers `external`, the class of an unknown call.
 */

import type { CallClass, CallEffect } from '@localixai/agent/agents'

/** Narrowest first: an effect's index is how far past the conversation it reaches. */
const EFFECT_ORDER: readonly CallEffect[] = ['read', 'view', 'session', 'files', 'host', 'external']

/** The class of a call nothing vouches for. */
export const UNKNOWN_CALL_CLASS: CallClass = { effect: 'external' }

/** The one class covering every call in `classes`: the widest effect, every flag kept. An empty
 *  list proves nothing, so it is {@link UNKNOWN_CALL_CLASS}. */
export function widestCallClass(classes: readonly CallClass[]): CallClass {
  if (classes.length === 0) return UNKNOWN_CALL_CLASS
  let effect: CallEffect = 'read'
  let irreversible = false
  let needsHuman = false
  for (const call of classes) {
    if (EFFECT_ORDER.indexOf(call.effect) > EFFECT_ORDER.indexOf(effect)) effect = call.effect
    irreversible ||= call.irreversible === true
    needsHuman ||= call.needsHuman === true
  }
  return {
    effect,
    ...(irreversible ? { irreversible: true } : {}),
    ...(needsHuman ? { needsHuman: true } : {}),
  }
}

/**
 * A `classify` for a tool whose input names its verb in `action`, and optionally batches verbs
 * as `actions: [{ action }, …]`. Each step is looked up in `table`; the call answers the widest
 * step. A step with no `action`, or one the table lacks, is unknown — so the whole call is.
 * An input carrying both forms is judged on both (the tool refuses it, but the class must not
 * depend on which form the body happens to check first).
 */
export function classifyByAction(
  table: Readonly<Record<string, CallClass>>,
): (input: unknown) => CallClass {
  const classOf = (step: unknown): CallClass => {
    const action = (step as { action?: unknown } | null)?.action
    // Own keys only: `toString` must not resolve to Object.prototype's and read as a class.
    return typeof action === 'string' && Object.prototype.hasOwnProperty.call(table, action)
      ? table[action]!
      : UNKNOWN_CALL_CLASS
  }
  return (input) => {
    const call = (input ?? {}) as { action?: unknown; actions?: unknown }
    const steps: unknown[] = []
    if (call.action !== undefined) steps.push(call)
    if (Array.isArray(call.actions)) steps.push(...call.actions)
    else if (call.actions !== undefined) return UNKNOWN_CALL_CLASS
    return steps.length === 0 ? UNKNOWN_CALL_CLASS : widestCallClass(steps.map(classOf))
  }
}
