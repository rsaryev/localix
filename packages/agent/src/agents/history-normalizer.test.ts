import { describe, expect, test } from 'bun:test'

import type { AgentMessage } from './types'
import { normalizeToolCallHistory } from './history-normalizer'

const assistant = (content: Extract<AgentMessage, { role: 'assistant' }>['content']) =>
  ({
    role: 'assistant',
    content,
    model: 'test-model',
    timestamp: 20,
  }) satisfies AgentMessage

describe('normalizeToolCallHistory', () => {
  test('inserts stable aborted results immediately after a call while preserving order', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'start', timestamp: 10 },
      assistant([
        { type: 'text', text: 'working' },
        {
          type: 'tool_call',
          id: 'completed',
          name: 'Read',
          arguments: { path: 'a.txt' },
        },
        {
          type: 'tool_call',
          id: 'interrupted',
          name: 'Write',
          arguments: { path: 'b.txt' },
        },
      ]),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'completed',
            toolName: 'Read',
            content: 'contents',
          },
        ],
        timestamp: 30,
      },
      { role: 'user', content: 'continue', timestamp: 40 },
    ]

    const normalized = normalizeToolCallHistory(messages)

    expect(normalized).toEqual([
      messages[0],
      messages[1],
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'interrupted',
            toolName: 'Write',
            content: 'aborted',
            isError: true,
          },
        ],
        timestamp: 20,
      },
      messages[2],
      messages[3],
    ])
    expect(normalizeToolCallHistory(normalized)).toEqual(normalized)
  })

  test('removes orphan results without reordering valid results or surrounding messages', () => {
    const messages: AgentMessage[] = [
      assistant([{ type: 'tool_call', id: 'valid', name: 'Read', arguments: {} }]),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'orphan-before',
            toolName: 'Bash',
            content: 'stale',
          },
          {
            type: 'tool_result',
            toolCallId: 'valid',
            toolName: 'Read',
            content: 'kept',
          },
          {
            type: 'tool_result',
            toolCallId: 'orphan-after',
            toolName: 'Write',
            content: 'stale',
          },
        ],
        timestamp: 30,
      },
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'only-orphan',
            toolName: 'Read',
            content: 'drop the message',
          },
        ],
        timestamp: 31,
      },
      { role: 'user', content: 'tail', timestamp: 40 },
    ]

    expect(normalizeToolCallHistory(messages)).toEqual([
      messages[0],
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'valid',
            toolName: 'Read',
            content: 'kept',
          },
        ],
        timestamp: 30,
      },
      messages[3],
    ])
    expect(messages[1]).toHaveProperty('results.length', 3)
  })

  test('leaves an already paired history structurally unchanged', () => {
    const messages: AgentMessage[] = [
      assistant([{ type: 'tool_call', id: 'call-1', name: 'Read', arguments: {} }]),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            toolName: 'Read',
            content: 'ok',
          },
        ],
        timestamp: 30,
      },
    ]

    const normalized = normalizeToolCallHistory(messages)
    expect(normalized).toEqual(messages)
    expect(normalized[0]).toBe(messages[0])
    expect(normalized[1]).toBe(messages[1])
  })

  test('repairs a result tool name from its originating call id', () => {
    const messages: AgentMessage[] = [
      assistant([{ type: 'tool_call', id: 'call-1', name: 'Read', arguments: {} }]),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            toolName: 'stale_tool_name',
            content: 'contents',
            details: { source: 'persisted-history' },
          },
        ],
        timestamp: 30,
      },
    ]

    const normalized = normalizeToolCallHistory(messages)

    expect(normalized[1]).toEqual({
      role: 'tool',
      results: [
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          toolName: 'Read',
          content: 'contents',
          details: { source: 'persisted-history' },
        },
      ],
      timestamp: 30,
    })
    expect(normalizeToolCallHistory(normalized)).toEqual(normalized)
    expect((messages[1] as Extract<AgentMessage, { role: 'tool' }>).results[0]?.toolName).toBe(
      'stale_tool_name',
    )
  })

  test('does not guess a tool name when duplicate call ids disagree', () => {
    const messages: AgentMessage[] = [
      assistant([
        { type: 'tool_call', id: 'duplicate', name: 'Read', arguments: {} },
        { type: 'tool_call', id: 'duplicate', name: 'Write', arguments: {} },
      ]),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'duplicate',
            toolName: 'legacy-name',
            content: 'ambiguous',
          },
        ],
        timestamp: 30,
      },
    ]

    const normalized = normalizeToolCallHistory(messages)
    expect(normalized[1]).toBe(messages[1])
  })
})
