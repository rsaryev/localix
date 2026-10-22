import type { CcHookOutcome } from './contracts'
import type { CcHooksRuntime, StopResult } from './runtime-contracts'

const noop = async () => {}
export const EMPTY_RUNTIME: CcHooksRuntime = {
  active: false,
  async runSessionStart() {
    return {}
  },
  async runUserPromptSubmit() {
    return { blocked: false }
  },
  async runPreToolUse() {
    return { decision: 'proceed', didRewrite: false }
  },
  async runPostToolUse() {
    return {}
  },
  async runPostToolUseFailure() {
    return {}
  },
  async runStop() {
    return { blocked: false }
  },
  runSessionEnd: noop,
  runNotification: noop,
  async runSubagentStart() {
    return {}
  },
  async runSubagentStop() {
    return { blocked: false }
  },
  async runPreCompact() {
    return { blocked: false }
  },
  async runUserPromptExpansion() {
    return { blocked: false }
  },
  async runPermissionRequest() {
    return {}
  },
  hasHooks: () => false,
  approveWithInput() {},
  takeApprovedInput: () => undefined,
  async runPermissionDenied() {
    return { retry: false }
  },
  async runPostToolBatch() {
    return { stop: false }
  },
  runStopFailure: noop,
  async runTaskCreated() {
    return { blocked: false }
  },
  async runTaskCompleted() {
    return { blocked: false }
  },
  async runTeammateIdle() {
    return { blocked: false }
  },
  runPostCompact: noop,
  runInstructionsLoaded: noop,
  async runConfigChange() {
    return { blocked: false }
  },
  async runCwdChanged() {
    return {}
  },
  async runFileChanged() {
    return {}
  },
  async runPreModelSwitch() {
    return { decision: 'proceed' }
  },
  async runPostModelSwitch() {
    return {}
  },
  fileChangedWatchNames: () => [],
  async runElicitation() {
    return undefined
  },
  async runElicitationResult() {
    return undefined
  },
  async runMessageDisplay() {
    return {}
  },
  async runWorktreeCreate() {
    return undefined
  },
  stoppedBy: () => undefined,
}

/** Join non-empty context strings with a blank line. */
export function joinContext(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  return kept.length > 0 ? kept.join('\n\n') : undefined
}

/** The context every handler of a context-carrying event contributed, joined. */
export function contextFrom(outcomes: CcHookOutcome[]): string | undefined {
  return joinContext(outcomes.map((o) => o.additionalContext))
}

/**
 * The block verdict for a decision-carrying event that CANNOT short-circuit
 * (Stop / SubagentStop / PreCompact): every handler runs, the run is blocked if
 * ANY of them blocked, and the last handler to give a reason owns it.
 */
export function blockedFrom(outcomes: CcHookOutcome[]): StopResult {
  let blocked = false
  let reason: string | undefined
  for (const o of outcomes) {
    if (o.blocked || o.decision === 'block') {
      blocked = true
      reason = o.blockReason || o.reason || reason
    }
  }
  return { blocked, ...(reason ? { reason } : {}) }
}

/**
 * Stop / SubagentStop: a block keeps the agent working, and so does a hook's
 * `hookSpecificOutput.additionalContext` without one (hooks.md, Stop decision control: "Non-error
 * feedback for Claude. The conversation continues so Claude can act on it"). The feedback rides
 * the same bounded continuation as a block, marked as feedback rather than a refusal.
 */
export function stopVerdictFrom(outcomes: CcHookOutcome[]): StopResult {
  const verdict = blockedFrom(outcomes)
  if (verdict.blocked) return verdict
  const feedback = contextFrom(outcomes)
  return feedback ? { blocked: true, reason: feedback, feedback: true } : verdict
}
