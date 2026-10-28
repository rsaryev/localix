import { describe, expect, test } from 'bun:test'

import type { AgentTurnSource } from './conversation-strategy'
import { defaultQueuePolicy, QUEUE_PRIORITY } from './queue-policy'

const priority = (producer: AgentTurnSource) =>
  defaultQueuePolicy.priority({ kind: 'agent-turn', producer })

describe('queue bands', () => {
  test('answers owed to the person run before their next message, which runs before machine wakes', () => {
    const next = defaultQueuePolicy.priority({ kind: 'wake', producer: 'user-busy' })
    expect(next).toBe(QUEUE_PRIORITY.user)
    for (const owed of ['user-default', 'runtime'] as const)
      expect(priority(owed)).toBeLessThan(next)
    expect(next).toBeLessThan(QUEUE_PRIORITY.wake)
  })
})
