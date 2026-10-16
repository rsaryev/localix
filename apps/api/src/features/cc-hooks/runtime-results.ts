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
