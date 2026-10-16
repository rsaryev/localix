import { describe, expect, test } from 'bun:test'

import {
  admitDelegation,
  DEFAULT_DELEGATION_BUDGET,
  DELEGATIONS_PER_HUMAN_TURN,
} from './delegation-budget'

const facts = (over: Partial<Parameters<typeof admitDelegation>[1]> = {}) => ({
  createdSinceHuman: 0,
  ...over,
})

describe('the runaway bound: new children since the person last wrote', () => {
  test('admits up to the limit and refuses the next', () => {
    expect(
      admitDelegation(
        DEFAULT_DELEGATION_BUDGET,
        facts({ createdSinceHuman: DELEGATIONS_PER_HUMAN_TURN - 1 }),
      ).ok,
    ).toBe(true)
    const verdict = admitDelegation(
      DEFAULT_DELEGATION_BUDGET,
      facts({ createdSinceHuman: DELEGATIONS_PER_HUMAN_TURN }),
    )
    expect(verdict.ok).toBe(false)
  })

  test('the refusal names the way forward: message the children it has, and when it resets', () => {
    // A bare "limit exceeded" makes a model retry the identical call.
    const verdict = admitDelegation(
      DEFAULT_DELEGATION_BUDGET,
      facts({ createdSinceHuman: DELEGATIONS_PER_HUMAN_TURN }),
    )
    const reason = !verdict.ok ? verdict.reason : ''
    expect(reason).toContain(String(DELEGATIONS_PER_HUMAN_TURN))
    expect(reason).toContain('`fork` action:"message"')
    expect(reason).not.toContain('`agents`')
    expect(reason).toContain('resets when the user writes again')
  })

  test('concurrency and depth are not its reasons — the lanes and the hierarchy own those', () => {
    // The budget used to refuse a fourth running child and any grandchild; it counts only now.
    expect(Object.keys(DEFAULT_DELEGATION_BUDGET)).toEqual(['maxPerHumanTurn'])
  })

  test('a broken count (Infinity) degrades to zero, not to a permanent lockout', () => {
    // `Infinity >= n` is true: unclamped, a broken aggregate would refuse every spawn forever.
    expect(
      admitDelegation(DEFAULT_DELEGATION_BUDGET, facts({ createdSinceHuman: Infinity })).ok,
    ).toBe(true)
  })
})
