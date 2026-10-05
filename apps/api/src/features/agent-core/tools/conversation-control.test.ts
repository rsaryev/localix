import { describe, expect, test } from 'bun:test'

import { completedConversationControl } from '../conversation-control-request'
import { createConversationControlTool } from './conversation-control'

describe('conversation_control', () => {
  test('a delegated-team descriptor exposes scheduling with fixed membership', () => {
    const tool = createConversationControlTool({
      membership: 'fixed',
      finish: async () => ({ invited: [], removed: [], next: [] }),
    })
    expect(tool.inputSchema.safeParse({ next: ['qa'] }).success).toBe(true)
    expect(tool.inputSchema.safeParse({ invite: ['qa'], next: [] }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ remove: ['qa'], next: [] }).success).toBe(false)
  })

  test('classify: every call changes only this conversation, so it is session', () => {
    const tool = createConversationControlTool({
      finish: async () => ({ invited: [], removed: [], next: [] }),
    })
    expect(tool.classify?.({ next: ['qa'] })).toEqual({ effect: 'session' })
    expect(tool.classify?.(undefined)).toEqual({ effect: 'session' })
  })

  test('deduplicates membership and scheduling references and terminates the turn', async () => {
    const calls: unknown[] = []
    const tool = createConversationControlTool({
      finish: async (id, request) => {
        calls.push({ id, request })
        return { invited: ['@qa'], removed: [], next: ['@qa'] }
      },
    })
    expect(tool.presentation).toEqual({ transcript: 'hidden' })
    const result = await tool.execute('call-1', {
      next: ['qa', 'qa'],
      invite: ['@qa', '@qa'],
    })
    expect(calls).toEqual([
      {
        id: 'call-1',
        request: { next: ['qa'], invite: ['@qa'] },
      },
    ])
    expect(result.terminate).toBe(true)
  })

  test('recognizes only a completed conversation_control call', () => {
    expect(
      completedConversationControl([
        {
          id: 'ok',
          type: 'tool_call',
          name: 'conversation_control',
          status: 'completed',
          input: { next: ['qa'] },
        },
      ]),
    ).toEqual({
      toolCallId: 'ok',
      request: { next: ['qa'] },
    })
  })
})
