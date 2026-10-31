import { describe, expect, test } from 'bun:test'

import { admitDelegation, DELEGATIONS_PER_HUMAN_TURN } from './delegation-budget'

describe('the runaway bound: new children since the person last wrote', () => {
  test('admits up to the limit and refuses the next', () => {
    expect(admitDelegation(DELEGATIONS_PER_HUMAN_TURN - 1).ok).toBe(true)
    expect(admitDelegation(DELEGATIONS_PER_HUMAN_TURN).ok).toBe(false)
  })

  test('the refusal names the way forward: message the children it has, and when it resets', () => {
    // A bare "limit exceeded" makes a model retry the identical call.
    const verdict = admitDelegation(DELEGATIONS_PER_HUMAN_TURN)
    const reason = !verdict.ok ? verdict.reason : ''
    expect(reason).toContain(String(DELEGATIONS_PER_HUMAN_TURN))
    expect(reason).toContain('SendMessage')
    expect(reason).not.toContain('`agents`')
    expect(reason).toContain('resets when the user writes again')
  })

  test('a broken count (Infinity) degrades to zero, not to a permanent lockout', () => {
    // `Infinity >= n` is true: unclamped, a broken aggregate would refuse every spawn forever.
    expect(admitDelegation(Infinity).ok).toBe(true)
  })
})
