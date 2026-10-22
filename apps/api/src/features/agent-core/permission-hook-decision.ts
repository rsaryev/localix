/**
 * A Claude Code PreToolUse hook's `permissionDecision` on a call, as the gate applies it
 * (hooks.md, PreToolUse decision control):
 *
 *   - `allow` "skips the permission prompt, except for actions no mode auto-approves", and
 *     "deny and ask rules are still evaluated regardless of what the hook returns". So it lifts
 *     what a mode that stops asking lifts (`capabilities/permission-mode-policy.ts`): a question
 *     about the MANNER of a call (`dangerous`, `outside-workspace`, `effect:files` …) is set aside
 *     and the call gets the answer the other rules give. A named ask (`bash(git push*)`) or a deny
 *     still stands, and a call that cannot be undone (`catastrophic`) is still asked about.
 *   - `ask` "prompts the user to confirm", even for a call the rules allow; a deny still refuses.
 *     Its `permissionDecisionReason` is what the card says.
 *
 * `deny` never reaches the gate: the hook wrapper refuses the call itself.
 */
import { resourceClassOf } from './capability-resource-classes'
import { evaluate, type CallFacts, type PermissionRule, type ToolFacts } from './permission-engine'
import type { RuleDecision, VerdictOptions } from './permission-verdict'

export interface PreToolUseVerdict {
  decision: 'allow' | 'ask'
  /** `permissionDecisionReason`: shown on the card for `ask`. */
  reason?: string
}

/**
 * How the verdict travels from the hook wrapper to the gate inside the tool-call chain
 * (`chat/runtime/run/chain-gate.ts`): on the call's execution context, which every wrapper
 * between the two hands on unchanged.
 */
export interface PreToolUseVerdictCarrier {
  preToolUseVerdict?: PreToolUseVerdict
}

const asksAboutAClass = (rule: PermissionRule) =>
  rule.action === 'ask' && rule.pattern !== '*' && resourceClassOf(rule.pattern) !== undefined

/** The rule decision once the hook's verdict is applied; `byHook` when the hook allowed it. */
export function withHookVerdict(
  opts: VerdictOptions,
  judged: { decision: RuleDecision; facts: ToolFacts; call: CallFacts },
  hook: PreToolUseVerdict | undefined,
): { decision: RuleDecision; byHook: boolean } {
  const { decision } = judged
  if (!hook || decision.action === 'deny') return { decision, byHook: false }
  if (hook.decision === 'ask') {
    const message = hook.reason ?? (decision.action === 'ask' ? decision.message : undefined)
    return { decision: { action: 'ask', ...(message ? { message } : {}) }, byHook: false }
  }
  if (decision.action !== 'ask' || judged.call.catastrophic) return { decision, byHook: false }
  const rules = opts.rules.filter((rule) => !asksAboutAClass(rule))
  const lifted = evaluate(rules, judged.facts, judged.call, opts.preapprovedRules)
  return { decision: lifted, byHook: lifted.action === 'allow' }
}
