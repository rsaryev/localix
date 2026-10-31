/**
 * THE RULE LANGUAGE — what a permission rule matches and which one decides. Pure: no IO,
 * no human, no runtime state.
 *
 * ONE LIST, LAST MATCH WINS. The rules are the agent's own, in order, general to specific,
 * and the last one that matches the call is the answer. That is the same sentence
 * `capabilities/rule.ts` states for the stored form, and deliberately so: this file evaluates
 * the projection of that list against a live call, and two different resolution rules for one
 * list is how the settings screen and the run learn to disagree.
 *
 * What used to be here: a BASELINE of unscoped defaults evaluated alongside scoped capability
 * rules, with `deny` terminal in the first pass, the strictest verdict taken across scopes in
 * the second, and a carve-out letting a specific scoped `allow` silence a baseline `ask`.
 * Three resolution rules in one function, each correct on its own and jointly unreadable. The
 * baseline is now the first few rows of the same list (see `builtin-agent-presets.ts`), so
 * ordering alone says what all three used to.
 *
 * The RUNTIME half — the gate that enacts a decision on a live tool call — lives in
 * `permission-gate.ts`, which depends on this file and never the other way round.
 */
import type { CallClass } from '@localixai/agent/agents'

import { splitCompoundCommand } from './tools/bash/bash-command-shape'
import type { PermissionRule as StoredPermissionRule } from '../projects/contracts'
import { matches } from './capability-rule'
import { matchesCapabilityCall } from './capability-call-match'
import type { CallFacts } from './permission-facts'

export type PermissionRule = StoredPermissionRule
export type PermissionAction = PermissionRule['action']
export { type CallFacts, extractCallFacts } from './permission-facts'

/** What a rule's `permission` is matched against: the tool, and its own class of this call. */
export interface ToolFacts extends CallClass {
  name: string
}

/**
 * Does an ALLOW pattern cover every command a call would run?
 *
 * Exported because a session grant asks exactly this question, and asking it twice in two
 * places is how the answers drift: a grant that matched more loosely than the equivalent
 * written rule would be a quieter way to reach the same over-permission.
 *
 * Command substitution hides the real commands, so it is never provable — refusing costs a
 * confirm, not the call.
 */
export function allowPatternCoversCommands(pattern: string, commands: readonly string[]): boolean {
  const parsed = commands.map((command) => splitCompoundCommand(command))
  if (parsed.some((segments) => segments === null)) return false
  const segments = parsed.flatMap((parts) => parts ?? [])
  return segments.length > 0 && segments.every((segment) => matches(pattern, segment))
}

/**
 * Which rule decides this call.
 *
 * Last match wins, with no special case for any effect: a `deny` written before a narrower
 * `allow` is an allowlist with an exception, which is the shape every preset is written in.
 * `rule` is the decisive match (absent when nothing matched), so the gate can attribute the
 * decision — "which rule let this run?" — not just enact it.
 */
export function evaluate(
  rules: readonly PermissionRule[],
  tool: ToolFacts,
  call: CallFacts,
  preapprovedRules: readonly PermissionRule[] = [],
): { action: PermissionAction; message?: string; rule?: PermissionRule } {
  let result: { action: PermissionAction; message?: string; rule?: PermissionRule } = {
    action: 'allow',
  }
  for (const rule of rules) {
    if (
      matches(rule.permission, tool.name) &&
      matchesCapabilityCall(rule.pattern, rule.action, call, tool)
    ) {
      result = { action: rule.action, message: rule.message, rule }
    }
  }
  // A skill's grant answers only the catch-all question (`*`), Localix's form of Claude Code's
  // default-mode prompt for a call no rule decides. A narrowed ask is an authored rule and still
  // asks, as in Claude Code ("Deny and ask rules still override allowed-tools"); a grant never
  // changes the authored list's order or opens a denied capability.
  if (result.action === 'ask' && result.rule?.pattern === '*') {
    const grant = evaluate(preapprovedRules, tool, call)
    if (grant.rule?.action === 'allow') return grant
  }
  return result
}

/** Compact human-readable form of a matched rule, e.g. `bash(git *)`. */
export function describeRule(rule: PermissionRule): string {
  return `${rule.permission}(${rule.pattern})`
}
