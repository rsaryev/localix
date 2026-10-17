import { describe, expect, test } from 'bun:test'

import type { AgentStreamEvent } from '../../contracts'
import { publishHumanAssignment } from './human-assignment'

describe('publishHumanAssignment — telling the person about a card', () => {
  const captured: AgentStreamEvent[] = []
  const io = {
    streamRegistry: {
      publish: (_u: string, _s: string, event: AgentStreamEvent) => captured.push(event),
    },
  }
  const card = { sessionId: 's', messageId: 'card:T-1', from: 'lead', text: 'T-1 Approve copy' }

  test('the frame names who assigned it and what it is', () => {
    captured.length = 0
    publishHumanAssignment(io, 'u', card)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ type: 'user.mentioned', ...card })
  })

  test('long text is trimmed — a banner is not a transcript', () => {
    captured.length = 0
    publishHumanAssignment(io, 'u', { ...card, text: 'a very long card '.repeat(40) })
    const event = captured[0] as Extract<AgentStreamEvent, { type: 'user.mentioned' }>
    expect(event.text.length).toBeLessThanOrEqual(281)
    expect(event.text.endsWith('…')).toBe(true)
  })

  test('external channels hear the same assignment', () => {
    const heard: unknown[] = []
    publishHumanAssignment({ ...io, onHumanAssigned: (event) => heard.push(event) }, 'u', card)
    expect(heard).toEqual([card])
  })
})
