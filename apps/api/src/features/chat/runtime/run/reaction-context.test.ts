import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import { buildReactionContext } from './reaction-context'

const AGENT = 'agent:builtin:localix'

const row = (
  id: string,
  from: string,
  createdAt: number,
  reactions: { emoji: string; at: string }[] = [],
) =>
  ({
    id,
    createdAt,
    payload: {
      id,
      role: from === 'user' ? 'user' : 'assistant',
      from,
      content: `${id} said`,
      reactions: reactions.map((r) => ({ ...r, from: 'user' })),
    },
  }) as unknown as PersistedMessage

describe('reactions since the agent last spoke', () => {
  test('a mark placed after the agent’s last row is told, naming whose message it is on', () => {
    const text = buildReactionContext(
      [
        row('a1', AGENT, 10, [{ emoji: '👍', at: '5' }]),
        row('u2', 'user', 20, [{ emoji: '🎉', at: '30' }]),
      ],
      AGENT,
    )
    expect(text).toContain('the user reacted 🎉 to the user’s message')
    expect(text).not.toContain('👍')
  })

  test('a mark on the agent’s own message reads as "your message"', () => {
    const text = buildReactionContext(
      [row('u1', 'user', 1), row('a1', AGENT, 2, [{ emoji: '👍', at: '3' }])],
      AGENT,
    )
    expect(text).toContain('the user reacted 👍 to your message')
  })

  test('nothing marked since means no section', () => {
    expect(buildReactionContext([row('u1', 'user', 1), row('a1', AGENT, 2)], AGENT)).toBeUndefined()
  })
})
