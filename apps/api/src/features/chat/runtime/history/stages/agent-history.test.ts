import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../../../contracts'
import { projectAgentHistory } from './agent-history'
import { toModelMessages } from '@localixai/agent/agents/chat'

const QA = 'agent:qa'

function row(
  id: string,
  from: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Record<string, unknown> = {},
): PersistedMessage {
  return {
    id,
    sessionId: 's',
    userId: 'u',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    payload: { id, role, from, content, ...extra },
  } as PersistedMessage
}

describe('agent-history — the transcript as the agent reads it', () => {
  test('the agent keeps its own rows as its own words, tool items included', () => {
    const [projected] = projectAgentHistory([
      row('a', QA, 'assistant', 'mine', {
        items: [{ type: 'tool_call', id: 't1', name: 'Read' }],
      }),
    ])
    expect(projected!.payload.role).toBe('assistant')
    expect(projected!.payload.content).toBe('mine')
    expect(projected!.payload.items).toHaveLength(1)
  })

  test('an empty silent turn does not re-enter the history', () => {
    const silent = row('a', QA, 'assistant', '', { isInternal: true })
    expect(projectAgentHistory([silent])).toHaveLength(0)
  })

  test('silent tool work survives all the way to the model', () => {
    const silent = row('work', QA, 'assistant', '', {
      isInternal: true,
      items: [
        {
          type: 'tool_call',
          id: 't1',
          toolCallId: 't1',
          name: 'Read',
          status: 'completed',
          input: { path: 'notes/secret' },
          resultText: 'secret: violet',
        },
      ],
    })
    const own = projectAgentHistory([silent], new Set(['Read']))
    expect(JSON.stringify(toModelMessages(own.map((m) => m.payload)))).toContain('secret: violet')
    expect(silent.payload.isInternal).toBe(true)
  })

  test('a failed turn of the agent stays in its history', () => {
    const failed = row('f', QA, 'assistant', 'Agent is unavailable', { failed: true })
    expect(projectAgentHistory([failed])).toHaveLength(1)
  })

  test('unavailable tools retain historical observations without executable calls', () => {
    for (const type of ['tool_call', 'command', 'file_change', 'mcp_call'] as const) {
      const mine = row('a', QA, 'assistant', '', {
        isInternal: true,
        items: [{ type, id: 't1', name: 'retired', resultText: 'verified result' }],
      })
      const [projected] = projectAgentHistory([mine], new Set())
      expect(projected!.payload.items).toMatchObject([
        {
          type: 'text',
          text: 'Historical observation from unavailable tool "retired":\nverified result',
        },
      ])
      expect(mine.payload.items![0]!.type).toBe(type)
    }
  })

  test('the user is the user', () => {
    const [projected] = projectAgentHistory([row('a', 'user', 'user', 'ship it')])
    expect(projected!.payload.role).toBe('user')
    expect(projected!.payload.content).toBe('ship it')
  })

  test('the agent never reads a call to a tool this run does not hold', () => {
    const mine = row('a', QA, 'assistant', 'checked', {
      items: [
        { type: 'tool_call', id: 't1', name: 'Read' },
        { type: 'tool_call', id: 't2', name: 'Browser' },
        { type: 'reasoning', id: 'r1' },
      ],
    })
    const [projected] = projectAgentHistory([mine], new Set(['Read']))
    expect(projected!.payload.items?.map((i) => (i as { id: string }).id)).toEqual(['t1', 'r1'])
  })

  test('no roster means no gating', () => {
    const mine = row('a', QA, 'assistant', 'checked', {
      items: [{ type: 'tool_call', id: 't1', name: 'anything' }],
    })
    expect(projectAgentHistory([mine])[0]!.payload.items).toHaveLength(1)
  })

  test('the projection is stable, so the prompt prefix can be cached', () => {
    const log = [row('a1', QA, 'assistant', 'hi')]
    expect(JSON.stringify(projectAgentHistory(log))).toBe(JSON.stringify(projectAgentHistory(log)))
  })
})
