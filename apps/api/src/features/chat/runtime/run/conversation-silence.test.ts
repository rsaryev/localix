import { describe, expect, test } from 'bun:test'
import type { AgentItem, ToolCallItem } from '@localixai/agent/agents'
import type { StoredMessagePayload } from '../../../../db'
import { isSilentConversationTurn, settleConversationTurn } from './conversation-silence'

const ack: ToolCallItem = {
  id: 'call_1',
  toolCallId: 'call_1',
  type: 'tool_call',
  name: 'protocol_fixture',
  activeVerb: 'Updating',
  status: 'completed',
  presentation: { transcript: 'hidden' },
}

const task: ToolCallItem = {
  id: 'task',
  toolCallId: 'task',
  type: 'tool_call',
  name: 'agents',
  activeVerb: 'Delegating',
  status: 'completed',
  input: { action: 'delegate', agent: '@qa', title: 'Build game', prompt: 'Build the game.' },
}

describe('isSilentConversationTurn — text wins over the tool', () => {
  test('a turn that wrote something and also made a hidden protocol call is NOT silent', () => {
    // Hiding the row would lose the message for the person.
    const payload = { content: 'I picked a word. Ready for the first question?', items: [ack] }
    expect(isSilentConversationTurn(payload)).toBe(false)
  })

  test('a hidden protocol call with nothing written is silence', () => {
    expect(isSilentConversationTurn({ content: '', items: [ack] })).toBe(true)
  })

  test('nothing written and no tool call is a failure, not silence', () => {
    expect(isSilentConversationTurn({ content: '   ', items: [] })).toBe(false)
  })

  test('declining to answer a reaction is silence', () => {
    const payload = { content: '', items: [] }
    expect(isSilentConversationTurn(payload, true)).toBe(true)
    expect(isSilentConversationTurn({ content: 'Fixed it.', items: [] }, true)).toBe(false)
  })

  const activities: AgentItem[] = [
    task,
    { id: 'text', type: 'text', status: 'completed', text: 'Assignment for the designer' },
    {
      id: 'shell',
      toolCallId: 'shell',
      type: 'command',
      name: 'Bash',
      status: 'completed',
      command: 'pwd',
    },
    {
      id: 'file',
      toolCallId: 'file',
      type: 'file_change',
      name: 'Write',
      status: 'completed',
      changes: [{ path: 'index.html', kind: 'add' }],
    },
    {
      id: 'mcp',
      toolCallId: 'mcp',
      type: 'mcp_call',
      name: 'extension',
      status: 'completed',
      server: 'fixture',
      tool: 'inspect',
    },
    { ...ack, status: 'failed' },
    { ...ack, status: 'aborted' },
    { ...ack, errorText: 'Tool unavailable' },
  ]

  test.each(activities)('retains activity with no flattened text: %j', (activity) => {
    for (const items of [[activity], [activity, ack]]) {
      expect(isSilentConversationTurn({ content: '', items })).toBe(false)
    }
  })

  test('reasoning alone does not turn an explicit silent acknowledgement into a reply', () => {
    const payload = {
      content: '',
      items: [{ id: 'r', type: 'reasoning', status: 'completed', text: 'Internal' }, ack],
    } satisfies Pick<StoredMessagePayload, 'content' | 'items'>
    expect(isSilentConversationTurn(payload)).toBe(true)
  })

  test('task-creation turn is persisted without withdrawing its streamed message', async () => {
    const payload: StoredMessagePayload = {
      id: 'reply',
      role: 'assistant',
      from: 'agent:builtin:localix',
      content: '',
      items: [task, ack],
    }
    const saved: StoredMessagePayload[] = []
    const events: unknown[] = []
    await settleConversationTurn(
      {
        persist: async (row) => {
          saved.push(row)
        },
        streamRegistry: {
          publish: (...args) => {
            events.push(args)
          },
        },
      },
      {
        silent: isSilentConversationTurn(payload),
        userId: 'u',
        sessionId: 's',
        payload,
      },
    )
    expect(saved).toEqual([payload])
    expect(saved[0]?.isInternal).not.toBe(true)
    expect(events).toEqual([])
  })

  test('a truly silent turn remains persisted but is withdrawn from the transcript', async () => {
    const payload: StoredMessagePayload = {
      id: 'reply',
      role: 'assistant',
      from: 'agent:builtin:localix',
      content: '',
      items: [ack],
    }
    const saved: StoredMessagePayload[] = []
    const events: unknown[] = []
    await settleConversationTurn(
      {
        persist: async (row) => {
          saved.push(row)
        },
        streamRegistry: {
          publish: (...args) => {
            events.push(args)
          },
        },
      },
      { silent: isSilentConversationTurn(payload), userId: 'u', sessionId: 's', payload },
    )
    expect(saved).toEqual([{ ...payload, isInternal: true }])
    expect(events).toEqual([
      ['u', 's', { type: 'message.removed', sessionId: 's', messageId: 'reply' }],
    ])
  })
})
