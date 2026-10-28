import { describe, expect, test } from 'bun:test'

import type { WakeSource } from '../../contracts'
import type { AgentTurnSource } from '../conversation-strategy'
import { createSelfWakeBudget, MAX_CONSECUTIVE_SELF_WAKES } from './self-wake-budget'

const wake = (source: WakeSource) => ({ internal: true, source })
const ticket = (source: AgentTurnSource) => ({ internal: true, agentTurn: { source } })

/** What one delivered wake looks like to the budget: the wake, then the drain's fan-out. */
function deliver(budget: ReturnType<typeof createSelfWakeBudget>, source: WakeSource): boolean {
  const admitted = budget.admit('s', wake(source))
  budget.admit('s', ticket('runtime'))
  return admitted
}

describe('self-wake budget', () => {
  test('the runtime ticket a wake fans out into does not reset the chain it belongs to', () => {
    // The defect this module exists for: every drained wake enqueues a `runtime` ticket,
    // and reading that ticket as external erased the streak, so the cap never bit.
    const budget = createSelfWakeBudget()
    const admitted = Array.from({ length: MAX_CONSECUTIVE_SELF_WAKES + 1 }, () =>
      deliver(budget, 'bg-job'),
    )
    expect(admitted.slice(0, MAX_CONSECUTIVE_SELF_WAKES).every(Boolean)).toBe(true)
    expect(admitted.at(-1)).toBe(false)
  })

  test('a turn a person caused restores the full budget', () => {
    const budget = createSelfWakeBudget()
    for (let i = 0; i < MAX_CONSECUTIVE_SELF_WAKES; i++) deliver(budget, 'subagent')
    budget.admit('s', ticket('user-default'))
    expect(deliver(budget, 'subagent')).toBe(true)
  })

  test('a queued user message and an external producer reset; hook rewakes count', () => {
    const budget = createSelfWakeBudget()
    for (let i = 0; i < MAX_CONSECUTIVE_SELF_WAKES; i++) deliver(budget, 'hook')
    expect(deliver(budget, 'hook')).toBe(false)
    expect(budget.admit('s', { internal: false, source: 'user-busy' })).toBe(true)
    for (let i = 0; i < MAX_CONSECUTIVE_SELF_WAKES; i++) deliver(budget, 'bg-monitor')
    expect(deliver(budget, 'loop')).toBe(true)
    expect(deliver(budget, 'bg-monitor')).toBe(true)
  })

  test('the ticket of a runtime delivery neither counts nor resets', () => {
    const budget = createSelfWakeBudget()
    for (let i = 0; i < MAX_CONSECUTIVE_SELF_WAKES; i++) deliver(budget, 'bg-job')
    budget.admit('s', ticket('runtime'))
    expect(deliver(budget, 'bg-job')).toBe(false)
  })

  test('streaks are per session and forgotten with the session', () => {
    const budget = createSelfWakeBudget()
    for (let i = 0; i < MAX_CONSECUTIVE_SELF_WAKES; i++) deliver(budget, 'bg-job')
    expect(budget.admit('other', wake('bg-job'))).toBe(true)
    budget.forget('s')
    expect(deliver(budget, 'bg-job')).toBe(true)
  })
})
