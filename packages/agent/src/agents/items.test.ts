import { describe, expect, test } from 'bun:test'

import {
  isToolBackedItem,
  isNarrativeItem,
  isItemStreaming,
  hasItemError,
  isTextItem,
  isReasoningItem,
  isCommandItem,
  isFileChangeItem,
  isMcpCallItem,
  isToolCallItem,
  type AgentItem,
  type CommandItem,
} from './items'

describe('item type guards', () => {
  const GUARDS: Array<[string, (i: AgentItem) => boolean]> = [
    ['text', isTextItem],
    ['reasoning', isReasoningItem],
    ['command', isCommandItem],
    ['file_change', isFileChangeItem],
    ['mcp_call', isMcpCallItem],
    ['tool_call', isToolCallItem],
  ]

  for (const [type, guard] of GUARDS) {
    test(`matches only "${type}" items`, () => {
      for (const [other] of GUARDS) {
        const item = { type: other, status: 'completed' } as unknown as AgentItem
        expect(guard(item)).toBe(other === type)
      }
    })
  }
})

describe('item predicates', () => {
  const it = (type: string, status = 'completed'): AgentItem =>
    ({ type, status }) as unknown as AgentItem

  test('isNarrativeItem: text/reasoning only', () => {
    expect(isNarrativeItem(it('text'))).toBe(true)
    expect(isNarrativeItem(it('reasoning'))).toBe(true)
    expect(isNarrativeItem(it('tool_call'))).toBe(false)
  })

  test('isItemStreaming: pending or running', () => {
    expect(isItemStreaming(it('text', 'pending'))).toBe(true)
    expect(isItemStreaming(it('text', 'running'))).toBe(true)
    expect(isItemStreaming(it('text', 'completed'))).toBe(false)
    expect(isItemStreaming(it('text', 'failed'))).toBe(false)
  })

  test('hasItemError: failed only', () => {
    expect(hasItemError(it('text', 'failed'))).toBe(true)
    expect(hasItemError(it('text', 'completed'))).toBe(false)
    expect(hasItemError(it('text', 'aborted'))).toBe(false)
  })
})

const cmd = (id: string, over: Partial<CommandItem> = {}): CommandItem => ({
  id,
  type: 'command',
  status: 'running',
  toolCallId: id,
  name: 'Bash',
  command: 'ls',
  ...over,
})

describe('isToolBackedItem', () => {
  test('distinguishes tool-backed from narrative items', () => {
    expect(isToolBackedItem(cmd('c'))).toBe(true)
    expect(isToolBackedItem({ id: 't', type: 'text', status: 'running', text: '' })).toBe(false)
  })
})
