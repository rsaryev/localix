import { describe, expect, test } from 'bun:test'

import type { AgentTurnSource } from './conversation-strategy'
import { agedPriority, defaultQueuePolicy, QUEUE_PRIORITY } from './queue-policy'

const priority = (producer: AgentTurnSource) =>
  defaultQueuePolicy.priority({ kind: 'agent-turn', producer })

describe('queue bands', () => {
  test('answers owed to the person run before their next message; a colleague chain after it', () => {
    const next = defaultQueuePolicy.priority({ kind: 'wake', producer: 'user-busy' })
    expect(next).toBe(QUEUE_PRIORITY.user)
    for (const owed of ['user-address', 'user-default', 'user-broadcast', 'runtime'] as const)
      expect(priority(owed)).toBeLessThan(next)
    expect(priority('agent-request')).toBeGreaterThan(next)
    expect(priority('agent-request')).toBeLessThan(QUEUE_PRIORITY.wake)
  })

  test('addressed participants answer before the rest of a broadcast', () => {
    expect(priority('user-address')).toBeLessThan(priority('user-broadcast'))
  })
})

describe('aging', () => {
  test("a colleague chain ages toward the person's next message but never past it", () => {
    // The chain used to age one step per dispatch without a floor, so after a few dispatches it
    // outranked a message the person had typed, and the person could not interrupt.
    let chain = priority('agent-request')
    for (let dispatch = 0; dispatch < 20; dispatch++) chain = agedPriority('agent-request', chain)
    expect(chain).toBeGreaterThan(QUEUE_PRIORITY.user)
  })

  test('answers owed to the person keep aging among themselves', () => {
    expect(agedPriority('user-default', -8)).toBe(-9)
  })
})
