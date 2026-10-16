import { describe, expect, test } from 'bun:test'
import type { ChatMessage } from '../chat'
import type { AgentItem } from './items'
import { projectContinuationItems } from './continuation-items'
import { toModelMessages } from './chat'

const text = (id: string, value: string): AgentItem => ({
  id,
  type: 'text',
  status: 'completed',
  text: value,
})
const row = (id: string, items: AgentItem[], continuedFromMessageId?: string) => ({
  id,
  role: 'assistant' as const,
  from: 'agent:localix',
  items,
  continuedFromMessageId,
})

describe('continuation item ownership', () => {
  test('repairs a replayed prefix for the UI and model without mutating persisted rows', () => {
    const tool: AgentItem = {
      id: 'call',
      type: 'tool_call',
      status: 'running',
      toolCallId: 'call',
      name: 'bash',
      activeVerb: 'Running',
      input: {},
    }
    const finished: AgentItem = { ...tool, status: 'completed', resultText: 'done' }
    const prefix = [text('before', 'Before'), tool]
    const messages = [
      row('first', prefix),
      row('second', [prefix[0]!, finished, text('after', 'After')], 'first'),
    ]
    const original = JSON.stringify(messages)
    const projected = projectContinuationItems(messages)
    expect(projected[0]?.items).toEqual([prefix[0], finished])
    expect(projected[1]?.items.map((item) => item.id)).toEqual(['after'])
    expect(JSON.stringify(messages)).toBe(original)
    const wire = toModelMessages(messages as ChatMessage[])
    expect(
      wire.flatMap((message) => (message.role === 'tool' ? message.results : [])),
    ).toHaveLength(1)
    expect(
      wire.flatMap((message) => (message.role === 'tool' ? message.results : []))[0]?.content,
    ).toBe('done')
  })

  test('does not equate independent calls or text with the same wording', () => {
    const messages = [
      row('first', [text('a', 'Same')]),
      row('second', [text('b', 'Same')], 'first'),
    ]
    expect(projectContinuationItems(messages)).toBe(messages)
    const independent = [
      row('first', [text('same-id', 'Same')]),
      row('second', [text('same-id', 'Same')]),
    ]
    expect(projectContinuationItems(independent)).toBe(independent)
  })

  test('handles a chain of continuations and ignores links to another author', () => {
    const first = text('a', 'A')
    const second = text('b', 'B')
    const messages = [
      row('first', [first]),
      row('second', [first, second], 'first'),
      row('third', [first, second, text('c', 'C')], 'second'),
      { ...row('other', [first], 'third'), from: 'agent:other' },
    ]
    expect(
      projectContinuationItems(messages).map((message) => message.items.map((item) => item.id)),
    ).toEqual([['a'], ['b'], ['c'], ['a']])
  })
})
