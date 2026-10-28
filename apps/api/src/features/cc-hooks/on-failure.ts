/**
 * `onFailure: "block"` (hooks.md, "Block the action when a hook fails"): a failed command or http
 * hook does "what exit code 2 does on that event, except on PermissionRequest, where it denies the
 * request". Stop, SubagentStop, and TaskCompleted are untouched: exit 2 there sends
 * Claude back to work, "and Claude can't repair a hook that won't run".
 */
import type { CcHookEvent, CcHookHandler, CcHookOutcome } from './contracts'

const UNAFFECTED: ReadonlySet<CcHookEvent> = new Set(['Stop', 'SubagentStop', 'TaskCompleted'])

/** The outcome a failed hook stands for: a block when the hook asked for one, else as it was. */
export function blockOnFailure(
  event: CcHookEvent,
  handler: CcHookHandler,
  outcome: CcHookOutcome,
): CcHookOutcome {
  if (handler.onFailure !== 'block' || !outcome.failed || UNAFFECTED.has(event)) return outcome
  const what =
    handler.kind === 'http' ? handler.httpUrl : [handler.command, ...(handler.args ?? [])].join(' ')
  const verb = outcome.failed === 'timeout' ? 'timed out' : 'failed'
  const message = [
    `${event} hook error: [${what}]: ${verb}; blocking because onFailure is "block"`,
    outcome.failureDetail,
  ]
    .filter(Boolean)
    .join('\n')
  return event === 'PermissionRequest'
    ? { ...outcome, permissionRequest: { behavior: 'deny', message } }
    : { ...outcome, blocked: true, blockReason: message }
}
