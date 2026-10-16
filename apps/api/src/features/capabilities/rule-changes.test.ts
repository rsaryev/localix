import { describe, expect, test } from 'bun:test'
import { applyRuleChanges } from './rule-changes'
import type { Rule } from './rule'

const rule = (action: string, resource: string, effect: Rule['effect']): Rule => ({
  action,
  resource,
  effect,
})

describe('applying rule changes to a scope', () => {
  test('replaces the row with the same action and resource', () => {
    const next = applyRuleChanges(
      [rule('tool:bash', '*', 'allow')],
      [{ action: 'tool:bash', resource: '*', effect: 'deny' }],
    )

    expect(next).toEqual([rule('tool:bash', '*', 'deny')])
  })

  test('leaves an argument rule alone when the capability itself changes', () => {
    const next = applyRuleChanges(
      [rule('tool:bash', 'rm *', 'ask'), rule('tool:bash', '*', 'allow')],
      [{ action: 'tool:bash', resource: '*', effect: 'deny' }],
    )

    expect(next).toEqual([rule('tool:bash', 'rm *', 'ask'), rule('tool:bash', '*', 'deny')])
  })

  /**
   * The difference the fourth effect exists for: removing the row is not the same as allowing.
   * A plugin nobody has ruled on is inert; one the user allowed runs.
   */
  test('`default` removes the row instead of writing one', () => {
    const next = applyRuleChanges(
      [rule('plugin:office', '*', 'allow'), rule('tool:read', '*', 'deny')],
      [{ action: 'plugin:office', resource: '*', effect: 'default' }],
    )

    expect(next).toEqual([rule('tool:read', '*', 'deny')])
  })

  test('written rows go last, so a change beats the general rule it excepts', () => {
    const next = applyRuleChanges(
      [rule('tool:*', '*', 'deny')],
      [{ action: 'tool:read', resource: '*', effect: 'allow' }],
    )

    expect(next).toEqual([rule('tool:*', '*', 'deny'), rule('tool:read', '*', 'allow')])
  })

  test('one request cannot contradict itself — the last change for a row wins', () => {
    const next = applyRuleChanges(
      [],
      [
        { action: 'skill:deploy', resource: '*', effect: 'allow' },
        { action: 'skill:deploy', resource: '*', effect: 'deny' },
      ],
    )

    expect(next).toEqual([rule('skill:deploy', '*', 'deny')])
  })

  test('no changes leaves the list untouched', () => {
    const current = [rule('tool:bash', '*', 'deny')]

    expect(applyRuleChanges(current, [])).toEqual(current)
  })
})
