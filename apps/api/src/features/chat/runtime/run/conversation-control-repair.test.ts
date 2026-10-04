import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../../../db'
import { settleConversationControlRepair } from './conversation-control-repair'

const payload = (texts: Array<{ id: string; text: string; turnIndex: number }>) =>
  ({
    id: 'assistant-1',
    role: 'assistant',
    content: texts.at(-1)?.text ?? '',
    items: [
      ...texts.map((text) => ({ type: 'text' as const, status: 'completed' as const, ...text })),
      {
        id: 'ack-1',
        type: 'tool_call' as const,
        name: 'conversation_control',
        toolCallId: 'ack-1',
        status: 'completed' as const,
        turnIndex: 1,
      },
    ],
  }) as StoredMessagePayload

describe('settleConversationControlRepair', () => {
  test('keeps the public answer when the repair turn contains only whitespace', () => {
    const settled = settleConversationControlRepair(
      payload([
        { id: 'text-0', text: 'Is it a deliberate choice?', turnIndex: 0 },
        { id: 'text-1', text: '\n\n', turnIndex: 1 },
      ]),
      1,
    )

    expect(settled.content).toBe('Is it a deliberate choice?')
    expect(settled.items?.filter((item) => item.type === 'text')).toMatchObject([
      { id: 'text-0', text: 'Is it a deliberate choice?' },
    ])
    expect(settled.items?.some((item) => item.type === 'tool_call')).toBe(true)
  })

  test('uses one revised answer when the repair turn repeats public prose', () => {
    const settled = settleConversationControlRepair(
      payload([
        { id: 'text-0', text: 'First draft', turnIndex: 0 },
        { id: 'text-1', text: 'Final question', turnIndex: 1 },
      ]),
      1,
    )

    expect(settled.content).toBe('Final question')
    expect(settled.items?.filter((item) => item.type === 'text')).toMatchObject([
      { id: 'text-1', text: 'Final question' },
    ])
  })

  test('uses only the latest draft when two repair turns contain prose', () => {
    const settled = settleConversationControlRepair(
      payload([
        { id: 'text-0', text: 'Original answer', turnIndex: 0 },
        { id: 'text-1', text: 'First repair draft', turnIndex: 1 },
        { id: 'text-2', text: 'Final repair draft', turnIndex: 2 },
      ]),
      1,
    )

    expect(settled.content).toBe('Final repair draft')
    expect(settled.items?.filter((item) => item.type === 'text')).toMatchObject([
      { id: 'text-2', text: 'Final repair draft' },
    ])
  })

  test('does not change ordinary multi-turn tool narration', () => {
    const original = payload([
      { id: 'text-0', text: 'Reading the file.', turnIndex: 0 },
      { id: 'text-1', text: 'The change is complete.', turnIndex: 1 },
    ])

    expect(settleConversationControlRepair(original, undefined)).toBe(original)
  })
})
