import type { CallClass } from '@localixai/agent/agents'
import { OBSERVING_ACTIONS } from './browser-actions'
import { inferAction, type BrowserInput } from './browser-input'

/**
 * One `browser` call's class, judged by WHAT WILL RUN, not by the action it names.
 *
 * The defect this exists to stop: `liftTrailingScreenshot` rewrites `{action:'steps',
 * steps:[click…, take_screenshot]}` into `{action:'take_screenshot', steps:[click…]}` BEFORE
 * the gate sees it, and the schema accepts `steps` on any action — so classifying by `action`
 * alone let clicks, typing and `evaluate` pass as a harmless screenshot while execute ran them
 * first. So any call carrying a non-empty `steps` is the steps batch it executes, whatever
 * action it names; the next action that grows a steps prelude inherits the rule.
 *
 * The drive actions (`steps`, `evaluate`) act on the user's RUNNING app — a click can submit a
 * form, `evaluate` runs arbitrary page JS — so they reach past prediction: `external`. The
 * observing actions, open/close included (they re-point the preview pane and run nothing),
 * are `view`: they change what the person is looking at and nothing durable. Browser history
 * is app-wide state that outlives the conversation, so pruning it is `host`, and a removed
 * entry does not come back. Anything unresolvable is `external`, the fail-closed answer.
 */
const VIEW: CallClass = { effect: 'view' }
const READ: CallClass = { effect: 'read' }
const DRIVE: CallClass = { effect: 'external' }
const PRUNE_HISTORY: CallClass = { effect: 'host', irreversible: true }

export function classifyBrowserCall(input: unknown): CallClass {
  const call = (input ?? {}) as BrowserInput
  if (Array.isArray(call.steps) && call.steps.length > 0) return DRIVE
  const action = inferAction(call)
  if (action === 'history') {
    const operation = call.history_operation
    if (operation === 'list' || operation === 'search') return READ
    if (operation === 'open') return VIEW
    if (operation === 'remove' || operation === 'clear') return PRUNE_HISTORY
    return DRIVE
  }
  return action && OBSERVING_ACTIONS.has(action) ? VIEW : DRIVE
}
