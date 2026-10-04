import { describe, expect, test } from 'bun:test'
import type { AgentItem, ToolCallItem } from '@localixai/agent/agents'
import { projectMessageItems } from './messageItemProjection'

const reasoning = (id: string, text: string): AgentItem => ({
  id,
  type: 'reasoning',
  status: 'completed',
  text,
})

const text = (id: string, value: string): AgentItem => ({
  id,
  type: 'text',
  status: 'completed',
  text: value,
})

describe('projectMessageItems', () => {
  const control: ToolCallItem = {
    id: 'finish',
    toolCallId: 'finish',
    type: 'tool_call',
    name: 'conversation_control',
    activeVerb: 'Updating conversation',
    status: 'completed',
    input: { next: [] },
    presentation: { transcript: 'hidden' },
  }

  test('suppresses only control traffic, retaining tool cards and public text', () => {
    const task: ToolCallItem = {
      ...control,
      id: 'task',
      toolCallId: 'task',
      name: 'write',
      presentation: undefined,
      input: { path: 'game.ts', content: 'export {}' },
    }
    const reply = text('reply', 'Game scaffolded; handing off to design.')
    expect(projectMessageItems([task, control])).toEqual([{ kind: 'item', item: task, index: 0 }])
    expect(projectMessageItems([task, reply, control])).toEqual([
      { kind: 'item', item: task, index: 0 },
      { kind: 'item', item: reply, index: 1 },
    ])
    expect(projectMessageItems([control])).toEqual([])
  })

  test.each(['failed', 'aborted'] as const)('keeps %s routing visible', (status) => {
    const failed = { ...control, status }
    expect(projectMessageItems([failed])).toEqual([{ kind: 'item', item: failed, index: 0 }])
  })

  test('visibility follows the descriptor, not a known tool name', () => {
    const renamed = { ...control, name: 'extension_protocol' }
    expect(projectMessageItems([renamed])).toEqual([])
    const ordinary = { ...control, presentation: undefined }
    expect(projectMessageItems([ordinary])).toEqual([{ kind: 'item', item: ordinary, index: 0 }])
  })

  test('groups adjacent reasoning parts into one stable display block separated by a blank line', () => {
    expect(projectMessageItems([reasoning('r1', 'first'), reasoning('r2', 'second')])).toEqual([
      { kind: 'reasoning', key: 'r1', text: 'first\n\nsecond', lastIndex: 1 },
    ])
  })

  test('keeps text and tools as hard reasoning-group boundaries', () => {
    const separator = text('t1', 'answer')
    expect(
      projectMessageItems([
        reasoning('r1', 'first'),
        reasoning('r2', 'second'),
        separator,
        reasoning('r3', 'third'),
      ]),
    ).toEqual([
      { kind: 'reasoning', key: 'r1', text: 'first\n\nsecond', lastIndex: 1 },
      { kind: 'item', item: separator, index: 2 },
      { kind: 'reasoning', key: 'r3', text: 'third', lastIndex: 3 },
    ])
  })

  test('absorbs empty streaming fragments without creating empty disclosures', () => {
    expect(projectMessageItems([reasoning('r1', ''), reasoning('r2', 'live')])).toEqual([
      { kind: 'reasoning', key: 'r1', text: 'live', lastIndex: 1 },
    ])
    expect(projectMessageItems([reasoning('r1', '  ')])).toEqual([])
  })
})
