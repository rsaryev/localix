import { describe, expect, test } from 'bun:test'
import type { AgentItem } from './items'
import { copyableMessageText } from './copy-text'

const item = (value: Partial<AgentItem> & Pick<AgentItem, 'id' | 'type'>): AgentItem =>
  ({ status: 'completed', ...value }) as AgentItem

describe('copyableMessageText', () => {
  test('copies ordered text items instead of an incomplete flat fallback', () => {
    expect(
      copyableMessageText({
        content: 'stale fallback',
        items: [
          item({ id: 'text-1', type: 'text', text: 'first' }),
          item({ id: 'reasoning-1', type: 'reasoning', text: 'private chain of thought' }),
          item({ id: 'tool-1', type: 'tool_call', toolCallId: 'call-1', name: 'Read' }),
          item({ id: 'text-2', type: 'text', text: 'second' }),
        ],
      }),
    ).toBe('first\n\nsecond')
  })

  test('preserves full source text and falls back for flat legacy messages', () => {
    const full = `${'x'.repeat(100_000)}\n😀`
    expect(
      copyableMessageText({
        items: [item({ id: 'text-1', type: 'text', text: full })],
      }),
    ).toBe(full)
    expect(copyableMessageText({ content: 'legacy' })).toBe('legacy')
  })

  test('does not expose reasoning or tool payloads as reply text', () => {
    expect(
      copyableMessageText({
        items: [
          item({ id: 'reasoning-1', type: 'reasoning', text: 'private' }),
          item({
            id: 'tool-1',
            type: 'tool_call',
            toolCallId: 'call-1',
            name: 'secret',
            resultText: 'tool secret',
          }),
        ],
      }),
    ).toBeNull()
  })
})
