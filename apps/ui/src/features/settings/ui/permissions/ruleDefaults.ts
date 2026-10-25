import type { CapabilityRule } from '@/shared/api/contracts'

/**
 * Whether two rule lists say the same thing.
 *
 * ORDER MATTERS. Within a scope the last match wins, so the same rules in another order are a
 * different policy — a set comparison would call a reordered list unchanged and hide the one
 * edit that changes the answer.
 *
 * `origin` is left out: it records which session proposed a rule and `evaluate` never reads it,
 * so a rule that matches what we ship IS what we ship, however it came to be written.
 */
export function sameRules(a: readonly CapabilityRule[], b: readonly CapabilityRule[]): boolean {
  const shape = (rules: readonly CapabilityRule[]) =>
    JSON.stringify(
      rules.map((rule) => [rule.action, rule.resource, rule.effect, rule.message ?? '']),
    )
  return shape(a) === shape(b)
}
