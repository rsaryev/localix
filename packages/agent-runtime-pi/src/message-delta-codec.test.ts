import { expect, test } from 'bun:test'
import type { AssistantMessageEvent, ToolCall } from '@earendil-works/pi-ai'
import { mapAssistantDelta, requirePiAssistant, toPiMessage } from './message-codec'

const origin = { api: 'openai-completions', provider: 'fixture', model: 'model' }
const partial = requirePiAssistant(
  toPiMessage({
    role: 'assistant',
    ...origin,
    content: [
      { type: 'text', text: 'cumulative', textSignature: 'text-sig' },
      {
        type: 'thinking',
        thinking: 'cumulative',
        thinkingSignature: 'thinking-sig',
        redacted: true,
      },
      {
        type: 'tool_call',
        id: 'partial-call',
        name: 'partial',
        arguments: { partial: true },
        thoughtSignature: 'partial-sig',
      },
    ],
    timestamp: 0,
  })[0]!,
)

test('text and reasoning phases preserve signatures without replaying cumulative content', () => {
  for (const [prefix, index, metadata] of [
    ['text', 0, { textSignature: 'text-sig' }],
    ['thinking', 1, { thinkingSignature: 'thinking-sig', redacted: true }],
  ] as const) {
    for (const [suffix, phase] of [
      ['start', 'start'],
      ['delta', 'delta'],
      ['end', 'end'],
    ] as const) {
      const event = {
        type: `${prefix}_${suffix}`,
        partial,
        contentIndex: index,
        content: 'cumulative',
        get delta() {
          if (suffix !== 'delta') throw new Error('Only delta events carry incremental text')
          return 'increment'
        },
      } as AssistantMessageEvent
      expect(mapAssistantDelta(event)).toEqual({
        kind: prefix === 'text' ? 'text' : 'reasoning',
        phase,
        contentIndex: index,
        delta: suffix === 'delta' ? 'increment' : '',
        origin,
        ...metadata,
      })
    }
  }
})

test('the final tool-call event owns the final opaque input and signature', () => {
  const final: ToolCall = {
    type: 'toolCall',
    id: 'final-call',
    name: 'final',
    arguments: { final: true },
    thoughtSignature: 'final-sig',
  }
  const delta = mapAssistantDelta({
    type: 'toolcall_end',
    contentIndex: 2,
    toolCall: final,
    partial,
  })
  expect(delta).toEqual({
    kind: 'tool_call',
    phase: 'end',
    contentIndex: 2,
    id: 'final-call',
    name: 'final',
    input: final.arguments,
    delta: '',
    origin,
    thoughtSignature: 'final-sig',
  })
  if (delta?.kind !== 'tool_call') throw new Error('Expected a tool call delta')
  expect(delta.input).toBe(final.arguments)
})
